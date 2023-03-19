
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


// const ms = require('ms');
let roomId = location.pathname.split('/');
roomId = roomId[roomId.length - 1];
// console.log(roomId);
let peerId = Math.floor(Math.random() * 0xFFFFFF).toString(16).substring(1);
console.log(peerId);

const configuration = {
    iceServers: [{
        // urls: 'stun:stun.l.google.com:19302'
        urls: 'stun:127.0.0.1:3478'
    }],
};

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
        this.ws.onopen = (e) => { this.emit("open", e); };
        this.ws.onclose = (e) => { console.log(e.data); };
        this.ws.onerror = (e) => { console.log(e.data); };
    }

    subscribe() {
        let room = new Room();
        this.ws.onmessage = (e) => {
            let msg = JSON.parse(e.data);
            if (msg.peer == peerId) {
                console.log("ignore self msg");
                return;
            }
            console.log(msg.data);
            if (msg.type == "sdp") {
                room.emit('sdp', msg);
            } else if (msg.type == "candidate") {
                room.emit('candidate', msg);
            } else if (msg.type == "signal") {
                room.emit('open', msg);
            }
        };

        this.sendMessage('join', "");
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

function updateLocalStatus(status) {
    let element = document.getElementById("localStatus");
    element.innerText = status;
}

function onSuccess() { }
function onError(e) {
    console.log(e);
}

const drone = new Dragon(roomId);
let room;
let pc;

drone.on('open', () => {
    room = drone.subscribe(roomId);
    room.on('open', msg => {
        if (msg.data === "StartActive") {
            createWebRTC(true);
        } else {
            createWebRTC(false);
        }
    });
});

function sendMessage(mtype, msg) {
    drone.sendMessage(mtype, msg);
}

function createWebRTC(isOfferer) {
    pc = new RTCPeerConnection(configuration);
    // 'onicecandidate' notifies us whenever an ICE agent needs to deliver a
    // message to the other peer through the signaling server

    addTracks();
    pc.onicecandidate = event => {
        console.log("receive new candidate");
        if (event.candidate) {
            sendMessage("candidate", event.candidate);
        }
    };

    if (isOfferer) {
        pc.onnegotiationneeded = async () => {
            console.log("onnegotiationneeded create offer");
            createOffer();
        };
    }

    // When a remote stream arrives display it in the #remoteVideo element
    pc.ontrack = event => {
        console.log("ontrack");
        const stream = event.streams[0];
        if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== stream.id) {
            remoteVideo.srcObject = stream;
            console.log("remote track added", stream.id);
        }
    };

    room.on('sdp', msg => {
        // This is called after receiving an offer or answer from another peer
        console.log("receive peer sdp", msg);
        pc.setRemoteDescription(new RTCSessionDescription(msg.data), () => {
            // When receiving an offer lets answer it
            console.log("remote sdp set");
            if (msg.data.type === 'offer') {
                pc.createAnswer().then(localDescCreated).catch(onError);
            }
        }, onError);
    });

    room.on('candidate', msg => {
        pc.addIceCandidate(new RTCIceCandidate(msg.data))
            .then(() => {
                console.log("Add New Peer IceCandidate");
            }).catch(onError);
    });
}

function createOffer() {
    pc.createOffer().then(localDescCreated).catch(onError);
}

function localDescCreated(desc) {
    console.log("local sdp created");
    pc.setLocalDescription(
        desc,
        () => {
            sendMessage('sdp', pc.localDescription);
            console.log("local sdp set");
        },
        onError
    );
}

function addTracks() {
    navigator.mediaDevices.getUserMedia({
        // audio: true,
        video: true,
    }).then(stream => {
        // Display your local video in #localVideo element
        localVideo.srcObject = stream;
        stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
            console.log("local PC addTrack", track.id, stream.id, track.kind);
        });
    }, onError);
}
