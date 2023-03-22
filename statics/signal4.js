
const configuration = {
    iceServers: [{
        // urls: 'stun:stun.l.google.com:19302'
        urls: 'stun:127.0.0.1:3478'
    }],
};

let roomId = location.pathname.split('/');
roomId = roomId[roomId.length - 1];
let peerId = Math.floor(Math.random() * 0xFFFFFF).toString(16).substring(1);
console.log(peerId);

class EventEmitter {
    constructor() {
        this.listeners = {};
    }
    on(type, callback) {
        this.listeners[type] = callback;
    }
    emit(type, ...args) {
        if (this.listeners[type]) {
            this.listeners[type](...args);
        }
    }
}

class CommonMsg {
    constructor(mtype, room, peer, msg) {
        this.type = mtype;
        this.room = room;
        this.peer = peer;
        this.data = msg;
    }
}

class Room extends EventEmitter { }

class Dragon extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        let url = "ws://" + location.hostname + ":" + location.port + "/v1/websocket/" + roomId + "/" + peerId;
        console.log(url);
        this.ws = new WebSocket(url);
        this.ws.onopen = (e) => {
            console.log("【signal】websocket connected");
            this.emit("open", e);
        };
        this.ws.onclose = (e) => { console.log(e.data); };
        this.ws.onerror = (e) => { console.log(e.data); };
    }

    subscribe() {
        let room = new Room();
        this.ws.onmessage = (e) => {
            let msg = JSON.parse(e.data);
            if (msg.peer == peerId) {
                return;
            }
            console.log("【signal】", msg.type, msg.data);
            if (msg.type == "sdp") {
                room.emit('sdp', msg);
            } else if (msg.type == "candidate") {
                room.emit('candidate', msg);
            } else if (msg.type == "start") {
                room.emit('open', msg);
            }
        };

        this.sendMessage('join', "");
        console.log("【signal】send join request");
        return room;
    }

    sendMessage(mtype, msg) {
        if (this.ws.readyState != WebSocket.OPEN) {
            console.log("websocket status", this.ws.readyState);
            return;
        }
        this.ws.send(JSON.stringify(new CommonMsg(mtype, roomId, peerId, msg)));
    }
}

function onSuccess() { }

function onError(e) {
    console.log(e);
}


let room;
let pc;
let room_ready = false;
let pc_ready = false;

createWebRTC();
const drone = new Dragon(roomId);
drone.on('open', () => {
    drone_ready = true;
    room = drone.subscribe(roomId);
    room.on('open', msg => {
        console.log("【signal】peer arrived, room onopen", msg.data);
        // createWebRTC(true);

        pc.onicecandidate = event => {
            console.log("【rtc】my new candidate from stun server");
            if (event.candidate) {
                sendMessage("candidate", event.candidate);
            }
        };

        room.on('sdp', msg => {
            // This is called after receiving an offer or answer from another peer
            console.log("【signal】receive peer sdp", msg);
            pc.setRemoteDescription(new RTCSessionDescription(msg.data), () => {
                // When receiving an offer lets answer it
                console.log("【signal】remote sdp set");
                if (msg.data.type === 'offer') {
                    console.log("【RTC】create answer");
                    pc.createAnswer().then(localDescCreated).catch(onError);
                }
            }, onError);
        });

        room.on('candidate', msg => {
            pc.addIceCandidate(new RTCIceCandidate(msg.data))
                .then(() => {
                    console.log("【signal】Add New Peer IceCandidate");
                }).catch(onError);
        });

        if (msg.data === "StartActive") {
            // createWebRTC(true);
            // if (isOfferer) {
            // console.log("【rtc】onnegotiationneeded create offer");
            // pc.createOffer().then(localDescCreated).catch(onError);
            // }
            room_ready = true;
            createOffer();
        } else if (msg.data === "StartPassive") {
            // createWebRTC(false);
        }
    });
});

function createOffer() {
    if (!room_ready || !pc_ready) return;
    console.log("【rtc】onnegotiationneeded create offer");
    pc.createOffer().then(localDescCreated).catch(onError);
}

function sendMessage(mtype, msg) {
    drone.sendMessage(mtype, msg);
}

function createWebRTC(isOfferer) {
    console.log("【rtc】createWebRTC");
    pc = new RTCPeerConnection(configuration);


    pc.onnegotiationneeded = async () => {
        console.log("【rtc】onnegotiationneeded");
        // if (isOfferer) {
        //     console.log("【rtc】onnegotiationneeded create offer");
        //     pc.createOffer().then(localDescCreated).catch(onError);
        // }
        pc_ready = true;
        createOffer();
    };

    // When a remote stream arrives display it in the #remoteVideo element
    pc.ontrack = event => {
        console.log("【rtc】receive remote ontrack");
        const stream = event.streams[0];
        if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== stream.id) {
            remoteVideo.srcObject = stream;
            console.log("【rtc】remote track added", stream.id);
        }
    };

    navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
    }).then(stream => {
        // Display your local video in #localVideo element
        localVideo.srcObject = stream;
        stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
            console.log("【rtc】local addTrack", track.id, stream.id, track.kind);
        });
    }, onError);


}

function localDescCreated(desc) {
    console.log("【rtc】local sdp created");
    pc.setLocalDescription(
        desc,
        () => {
            sendMessage('sdp', pc.localDescription);
            console.log("【rtc】local sdp set");
        },
        onError
    );
}