// Generate random room name if needed
if (!location.hash) {
    location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
}
const roomHash = location.hash.substring(1);
console.log(location.hash);

// TODO: Replace with your own channel ID
const drone = new ScaleDrone('yiS12Ts5RdNhebyM');
// Room name needs to be prefixed with 'observable-'
const roomName = 'observable-' + roomHash;
const configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

let room;
let pc;

function onSuccess() { }
function onError(e) {
    console.log(e);
}

drone.on('open', error => {
    if (error) {
        return console.error(error);
    }
    room = drone.subscribe(roomName);
    room.on('open', error => {
        if (error) {
            onError(error);
        }
    });
    // We're connected to the room and received an array of 'members'
    // connected to the room (including us). Signaling server is ready.
    room.on('members', members => {
        console.log('MEMBERS', members);
        // If we are the second user to connect to the room we will be creating the offer
        const isOfferer = members.length === 2;
        startWebRTC(isOfferer);
    });
});

// Send signaling data via Scaledrone
function sendMessage(message) {
    drone.publish({
        room: roomName,
        message
    });
}

function startWebRTC(isOfferer) {
    pc = new RTCPeerConnection(configuration);

    // 'onicecandidate' notifies us whenever an ICE agent needs to deliver a
    // message to the other peer through the signaling server
    pc.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ 'candidate': event.candidate });
        }
    };

    // If user is offerer let the 'negotiationneeded' event create the offer
    if (isOfferer) {
        pc.onnegotiationneeded = () => {
            console.log("onnegotiationneeded create offer");
            pc.createOffer().then(localDescCreated).catch(onError);
        };
    }

    // When a remote stream arrives display it in the #remoteVideo element
    pc.ontrack = event => {
        console.log("ontrack");
        const stream = event.streams[0];
        if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== stream.id) {
            remoteVideo.srcObject = stream;
            console.log("remote track added");
        }
    };


    navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
    }).then(stream => {
        // Display your local video in #localVideo element
        localVideo.srcObject = stream;
        // Add your stream to be sent to the conneting peer
        console.log("add local track");
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }, onError);

    // Listen to signaling data from Scaledrone
    room.on('data', (message, client) => {
        // Message was sent by us
        if (client.id === drone.clientId) {
            return;
        }

        if (message.sdp) {
            // This is called after receiving an offer or answer from another peer
            console.log("receive peer sdp");
            pc.setRemoteDescription(new RTCSessionDescription(message.sdp), () => {
                // When receiving an offer lets answer it
                console.log("remote sdp set");
                if (pc.remoteDescription.type === 'offer') {
                    console.log("create answer");
                    pc.createAnswer().then(localDescCreated).catch(onError);
                }
            }, onError);
        } else if (message.candidate) {
            console.log("receive peer ice candidate");
            // Add the new ICE candidate to our connections remote description
            pc.addIceCandidate(
                new RTCIceCandidate(message.candidate), onSuccess, onError
            );
        }
    });
}

function localDescCreated(desc) {
    console.log("local sdp create");
    pc.setLocalDescription(
        desc,
        () => {
            sendMessage({ 'sdp': pc.localDescription });
            console.log("local sdp set");
        },
        onError
    );
}
