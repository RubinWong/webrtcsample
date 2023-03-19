## go mod tidy

go run main.go


open browser, http://localhost:8080/v1/signal/roomid

issue:
1. In some cases, ontrack not fired.
    RTCPeerConnection.AddTrack after sdp exchange, this is somehow hard to fix.