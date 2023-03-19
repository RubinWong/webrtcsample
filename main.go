package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"ws/stund"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	MsgTypeJoin      = "join"
	MsgTypeSignal    = "signal"
	MsgTypeSdp       = "sdp"
	MsgTypeCandidate = "candidate"
	MsgTypeError     = "error"

	RoleCaller = 0
	RoleCallee = 1
)

func main() {
	g := gin.Default()

	g.LoadHTMLGlob("./html/*")

	g.Static("/statics", "./statics")
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	rg := g.Group("/v1")

	rg.GET("/websocket/:room_id/:user_id", WebsocketHandler)

	rg.GET("/example", func(ctx *gin.Context) {
		ctx.HTML(http.StatusOK, "example.html", nil)
	})

	rg.GET("/signal/:room_id", func(ctx *gin.Context) {
		ctx.HTML(http.StatusOK, "signal.html", nil)
	})

	rg.GET("/signal2/:room_id", func(ctx *gin.Context) {
		ctx.HTML(http.StatusOK, "signal2.html", nil)
	})

	go stund.ListenUDPAndServe("udp", ":3478")

	g.Run(":8080")
}

type JoinReq struct {
	RoomId string `uri:"room_id" binding:"required"`
	UserId string `uri:"user_id" binding:"required"`
}

func WebsocketHandler(ctx *gin.Context) {
	join := JoinReq{}
	if err := ctx.ShouldBindUri(&join); err != nil {
		ctx.String(http.StatusBadRequest, "no room_id specify")
		log.Println("bind request fail")
		return
	}
	log.Println("WebsocketHandler", join.RoomId, join.UserId)

	room := GetRoom(join.RoomId)

	upgrader := websocket.Upgrader{
		Subprotocols: []string{"protoo"},
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	conn, err := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		ctx.String(http.StatusInternalServerError, "somethong wrong")
		return
	}

	var user *User
	if user = room.GetUser(join.UserId); user != nil {
		user.Sock = conn
	} else {
		user = &User{
			Uid:       join.UserId,
			Sock:      conn,
			Room:      room,
			StopCh:    make(chan struct{}),
			MsgOutQue: make(chan *Message, 10),
		}
		room.AddUser(user)
		go user.Serve()
	}
}

type Room struct {
	Id      string
	Users   sync.Map
	WaitNum atomic.Int32
}

var Rooms sync.Map

func GetRoom(id string) (r *Room) {
	if v, ok := Rooms.Load(id); ok {
		r = v.(*Room)
	} else {
		r = &Room{Id: id}
		Rooms.Store(id, r)
		log.Println("NewRoom", r.Id)
	}
	return
}

func (r *Room) GetUser(uid string) (u *User) {
	if v, ok := r.Users.Load(uid); ok {
		u = v.(*User)
	}
	return
}

func (r *Room) AddUser(user *User) {
	r.Users.Store(user.Uid, user)
	log.Println("AddUser", r.Id, user.Uid)
}

func (r *Room) DelUser(uid string) {
	r.Users.Delete(uid)
	r.WaitNum.Add(-1)
	log.Println("DelUser", r.Id, uid)
}

func (r *Room) StartCall() {
	r.Users.Range(func(k, v any) bool {
		u := v.(*User)
		u.StartCall()
		return true
	})
}

type User struct {
	Uid       string
	Sock      *websocket.Conn
	StopCh    chan struct{}
	MsgOutQue chan *Message
	Room      *Room
	Role      int
}

func (u *User) Serve() {
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go u.ServeRead(wg)
	go u.ServeWrite(wg)
	wg.Wait()
	u.Sock.Close()
	u.Room.DelUser(u.Uid)
}

func (u *User) ServeWrite(wg *sync.WaitGroup) {
	tick := time.NewTicker(time.Second * 5)
	defer func() {
		wg.Done()
		tick.Stop()
	}()
	for {
		select {
		case <-u.StopCh:
			return
		case msg := <-u.MsgOutQue:
			if err := u.Sock.WriteMessage(msg.MsgType, msg.Data); err != nil {
				log.Println("serveWrite fail", err)
				return
			}
		case <-tick.C:
			if err := u.Sock.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (u *User) ServeRead(wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-u.StopCh:
			return
		default:
			msgType, data, err := u.Sock.ReadMessage()
			if err != nil {
				return
			}
			u.HandleMsg(&Message{MsgType: msgType, Data: data})
		}
	}
}

func (u *User) HandleMsg(msg *Message) {
	switch msg.MsgType {
	case websocket.TextMessage:
		log.Println(msg.MsgType, string(msg.Data))
		u.HandleTextMsg(msg)
	case websocket.BinaryMessage:
		log.Println(msg.MsgType, string(msg.Data))
	case websocket.CloseMessage:
		close(u.StopCh)
	case websocket.PingMessage:
		log.Println(msg.MsgType, string(msg.Data))
	case websocket.PongMessage:
		log.Println(msg.MsgType, string(msg.Data))
	}
}

func (u *User) HandleTextMsg(msg *Message) {
	req := &CommonRequest{}
	if err := json.Unmarshal(msg.Data, req); err != nil {
		u.NotifyError("parse request fail")
		log.Println("parse requst fail", string(msg.Data), err)
		return
	}

	switch req.Type {
	case MsgTypeJoin:
		u.OnJoin()
	case MsgTypeSignal:
		u.OnSignal(req.Data)
	case MsgTypeSdp:
		log.Println("receive sdp", req.PeerId)
		u.OnSdp(msg)
	case MsgTypeCandidate:
		u.OnCandidate(msg)
	case MsgTypeError:
		log.Println("receive error message", req.Data)
	}
}

func (u *User) OnJoin() {
	usernum := u.Room.WaitNum.Load()
	if usernum == 0 && u.Room.WaitNum.CompareAndSwap(usernum, 1) {
		// 先join的用户
		u.Role = RoleCaller
		u.Answer("success")
	} else {
		u.Role = RoleCallee
		// 后join的用户进入房间之后，通知双方进行后续流程
		u.Room.StartCall()
	}
}

func (u *User) OnSignal(data any) {
}

func (u *User) OnSdp(msg *Message) {
	u.SendToAnother(msg)
}

func (u *User) OnCandidate(msg *Message) {
	u.SendToAnother(msg)
}

func (u *User) SendToAnother(msg *Message) {
	u.Room.Users.Range(func(k, v any) bool {
		user := v.(*User)
		if user.Uid != u.Uid {
			log.Println("SendToAnother from ", u.Uid, " send to ", user.Uid)
			user.Send(msg)
		}
		return true
	})
}

func (u *User) StartCall() {
	if u.Role == RoleCaller {
		u.Answer("StartActive")
	} else {
		u.Answer("StartPassive")
	}
}

func (u *User) Answer(res string) {
	response := &CommonResponse{Type: MsgTypeSignal, RoomId: u.Room.Id, Data: res}
	if data, err := json.Marshal(response); err == nil {
		u.Send(&Message{MsgType: websocket.TextMessage, Data: data})
		return
	}
}

func (u *User) NotifyError(why string) {
	response := &CommonResponse{Type: MsgTypeError, RoomId: u.Room.Id, Data: why}
	if data, err := json.Marshal(response); err == nil {
		u.Send(&Message{MsgType: websocket.TextMessage, Data: data})
		return
	}
}

func (u *User) Send(msg *Message) {
	u.MsgOutQue <- msg
	log.Println("user send", string(msg.Data))
}

type Message struct {
	MsgType int
	Data    []byte
}

type CommonRequest struct {
	Type   string `json:"type"`
	RoomId string `json:"room"`
	PeerId string `json:"peer"`
	Data   any    `json:"data"`
}

type CommonResponse struct {
	Type   string `json:"type"`
	RoomId string `json:"room"`
	PeerId string `json:"peer"`
	Data   any    `json:"data"`
}
