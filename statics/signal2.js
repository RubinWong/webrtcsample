let roomId = location.pathname.split('/');
console.log(roomId);
roomId = roomId[roomId.length - 1];
console.log(roomId);
let peerId = Math.floor(Math.random() * 0xFFFFFF).toString(16).substring(1);
console.log(peerId);

const configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

class CommonMsg {
    constructor(mtype, room, peer, msg) {
        this.type = mtype;
        this.room = room;
        this.peer = peer;
        this.data = msg;
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

class Peer {
    constructor(room, peer) {
        this.room = room;
        this.peer = peer;
        this.createWebRTC();
        this.addTracks();
        this.createWebSocket();

    }

    sendMessage(mtype, msg) {
        if (this.ws.readyState != WebSocket.OPEN) {
            console.log("websocket status", this.ws.readyState);
            return;
        }
        this.ws.send(JSON.stringify(new CommonMsg(mtype, this.room, this.peer, msg)));
    }

    startSignal() {
        this.sendMessage("join", "");
    }

    createWebRTC() {
        this.pc = new RTCPeerConnection(configuration);

        // 'onicecandidate' notifies us whenever an ICE agent needs to deliver a
        // message to the other peer through the signaling server
        this.pc.onicecandidate = event => {
            if (event.candidate) {
                this.sendMessage("candidate", event.candidate);
            }
        };

        // If user is offerer let the 'negotiationneeded' event create the offer
        this.pc.onnegotiationneeded = () => {
            console.log("onnegotiationneeded");
        };

        // When a remote stream arrives display it in the #remoteVideo element
        this.pc.ontrack = async event => {
            console.log("ontrack");
            const stream = event.streams[0];
            if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== stream.id) {
                remoteVideo.srcObject = stream;
                console.log("remote track added");
            }
        };
    }

    createOffer() {
        console.log("onnegotiationneeded");
        this.pc.createOffer().then(
            (desc) => {
                console.log("local sdp set");
                this.pc.setLocalDescription(
                    desc,
                    () => {
                        this.sendMessage("sdp", this.pc.localDescription);
                        console.log("local sdp set");
                    },
                    onError
                );
            }

        ).catch(onError);
    }

    addTracks() {
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
        }).then(stream => {
            // Display your local video in #localVideo element
            localVideo.srcObject = stream;
            // Add your stream to be sent to the conneting peer
            console.log("add local track");
            stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
        }, onError);
    }

    createWebSocket() {
        let url = "ws://" + location.hostname + ":" + location.port + "/v1/websocket/" + roomId + "/" + peerId;
        console.log(url);
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
            updateLocalStatus("Signaling");
            this.startSignal();
        };
        this.ws.onclose = (e) => {
            console.log(e.data);
        };
        this.ws.onerror = (e) => {
            console.log(e.data);
        };
        this.ws.onmessage = (e) => {
            let msg = JSON.parse(e.data);
            if (msg.peer == this.peer) {
                console.log("ignore self msg");
                return;
            }
            // console.log(msg);
            if (msg.type == "sdp") {
                // This is called after receiving an offer or answer from another peer
                console.log("receive peer sdp");
                this.pc.setRemoteDescription(new RTCSessionDescription(msg.data), () => {
                    // When receiving an offer lets answer it
                    console.log("remote sdp set");
                    if (this.pc.remoteDescription.type === 'offer') {
                        this.pc.createAnswer().then(

                            (desc) => {
                                console.log("local sdp set");
                                this.pc.setLocalDescription(
                                    desc,
                                    () => {
                                        this.sendMessage("sdp", this.pc.localDescription);
                                        console.log("local sdp set");
                                    },
                                    onError
                                );
                            }

                        ).catch(onError);
                    }
                }, onError);
            } else if (msg.type == "candidate") {
                // console.log(msg.data);
                // Add the new ICE candidate to our connections remote description
                console.log("receive peer ice candidate");
                // Add the new ICE candidate to our connections remote description
                this.pc.addIceCandidate(
                    new RTCIceCandidate(msg.data), onSuccess, onError
                );
            } else if (msg.type == "signal") {
                if (msg.data == "StartActive") {
                    this.addTracks();
                    this.createOffer();
                }
            }
        };
    }
}

let p = new Peer(roomId, peerId);