(() => {
    const ROOM_CODE = window.ROOM_CODE;
    const WS_SCHEME = window.WS_SCHEME;
    const CLIENT_ID = Math.random().toString(36).slice(2, 10);
    const IS_HOST = window.IS_HOST;
    const CSRF_TOKEN = window.CSRF_TOKEN;
    let requireApproval = window.REQUIRE_APPROVAL;
    let hasPassword = window.HAS_PASSWORD;
    let awaitingApproval = false;

    const ICE_SERVERS = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Public TURN (Open Relay Project) - needed when peers are behind
        // symmetric NAT / restrictive firewalls where STUN alone can't
        // establish a direct connection.
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
        {
            urls: "turn:global.relay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
    ];

    let localStream = null;
    let socket = null;
    let displayName = "Guest";
    let micOn = true;
    let camOn = true;
    let screenSharing = false;
    let cameraTrack = null;

    // peerId -> { pc, tile, videoEl }
    const peers = {};

    // ---------- DOM refs ----------
    const prejoinScreen = document.getElementById("prejoin-screen");
    const waitingScreen = document.getElementById("waiting-screen");
    const callScreen = document.getElementById("call-screen");
    const previewVideo = document.getElementById("preview-video");
    const previewMicBtn = document.getElementById("preview-mic-btn");
    const previewCamBtn = document.getElementById("preview-cam-btn");
    const displayNameInput = document.getElementById("display-name-input");
    const joinBtn = document.getElementById("join-btn");
    const joinRequestsContainer = document.getElementById("join-requests");

    const passwordField = document.getElementById("password-field");
    const passwordInput = document.getElementById("password-input");
    const passwordError = document.getElementById("password-error");

    if (hasPassword && !IS_HOST) passwordField.classList.remove("hidden");

    if (IS_HOST) {
        const requireApprovalCheckbox = document.getElementById("require-approval-checkbox");
        const hostPasswordInput = document.getElementById("host-password-input");
        const saveSettingsBtn = document.getElementById("save-settings-btn");
        const settingsSavedMsg = document.getElementById("settings-saved-msg");

        saveSettingsBtn.addEventListener("click", async () => {
            const resp = await fetch(`/room/${ROOM_CODE}/settings/`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-CSRFToken": CSRF_TOKEN,
                },
                body: new URLSearchParams({
                    require_approval: requireApprovalCheckbox.checked ? "true" : "false",
                    password: hostPasswordInput.value,
                }),
            });
            const data = await resp.json();
            if (data.ok) {
                requireApproval = data.require_approval;
                hasPassword = data.has_password;
                hostPasswordInput.value = "";
                settingsSavedMsg.classList.remove("hidden");
                setTimeout(() => settingsSavedMsg.classList.add("hidden"), 2000);
            }
        });
    }

    async function verifyPassword(password) {
        const resp = await fetch(`/room/${ROOM_CODE}/verify-password/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-CSRFToken": CSRF_TOKEN,
            },
            body: new URLSearchParams({ password: password || "" }),
        });
        return resp.json();
    }

    const videoGrid = document.getElementById("video-grid");
    const micBtn = document.getElementById("mic-btn");
    const camBtn = document.getElementById("cam-btn");
    const screenshareBtn = document.getElementById("screenshare-btn");
    const chatBtn = document.getElementById("chat-btn");
    const leaveBtn = document.getElementById("leave-btn");
    const copyLinkBtn = document.getElementById("copy-link-btn");

    const chatPanel = document.getElementById("chat-panel");
    const closeChatBtn = document.getElementById("close-chat-btn");
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const chatMessages = document.getElementById("chat-messages");

    // ---------- Pre-join: get local media for preview ----------
    async function initPreview() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            previewVideo.srcObject = localStream;
            cameraTrack = localStream.getVideoTracks()[0];
        } catch (err) {
            alert("Could not access camera/microphone: " + err.message);
        }
    }
    initPreview();

    previewMicBtn.addEventListener("click", () => {
        micOn = !micOn;
        localStream.getAudioTracks().forEach(t => t.enabled = micOn);
        previewMicBtn.classList.toggle("active", micOn);
    });

    previewCamBtn.addEventListener("click", () => {
        camOn = !camOn;
        localStream.getVideoTracks().forEach(t => t.enabled = camOn);
        previewCamBtn.classList.toggle("active", camOn);
    });

    joinBtn.addEventListener("click", async () => {
        displayName = displayNameInput.value.trim() || "Guest";

        if (!IS_HOST) {
            joinBtn.disabled = true;
            const result = await verifyPassword(passwordInput.value);
            joinBtn.disabled = false;
            if (!result.ok) {
                passwordField.classList.remove("hidden");
                passwordError.classList.remove("hidden");
                return;
            }
        }
        passwordError.classList.add("hidden");

        if (requireApproval && !IS_HOST) {
            awaitingApproval = true;
            prejoinScreen.style.display = "none";
            waitingScreen.style.display = "flex";
            connectSocket();
        } else {
            enterCall();
        }
    });

    function enterCall() {
        prejoinScreen.style.display = "none";
        waitingScreen.style.display = "none";
        callScreen.style.display = "flex";
        micBtn.classList.toggle("active", micOn);
        camBtn.classList.toggle("active", camOn);
        addLocalTile();
        if (socket && socket.readyState === WebSocket.OPEN) {
            send({ type: "join", client_id: CLIENT_ID, name: displayName });
        } else {
            connectSocket();
        }
    }

    function showJoinRequest(peerId, name) {
        if (document.getElementById(`joinreq-${peerId}`)) return;
        const row = document.createElement("div");
        row.className = "join-request-row";
        row.id = `joinreq-${peerId}`;

        const label = document.createElement("span");
        label.textContent = `${name || "Guest"} wants to join`;

        const acceptBtn = document.createElement("button");
        acceptBtn.className = "btn btn-primary small";
        acceptBtn.textContent = "Admit";
        acceptBtn.addEventListener("click", () => {
            send({ type: "join-response", client_id: CLIENT_ID, target: peerId, accepted: true });
            row.remove();
        });

        const denyBtn = document.createElement("button");
        denyBtn.className = "btn btn-secondary small";
        denyBtn.textContent = "Deny";
        denyBtn.addEventListener("click", () => {
            send({ type: "join-response", client_id: CLIENT_ID, target: peerId, accepted: false });
            row.remove();
        });

        row.appendChild(label);
        row.appendChild(acceptBtn);
        row.appendChild(denyBtn);
        joinRequestsContainer.appendChild(row);
    }

    function handleJoinResponse(accepted) {
        if (!awaitingApproval) return;
        awaitingApproval = false;
        if (accepted) {
            enterCall();
        } else {
            document.getElementById("waiting-title").textContent = "The host declined your request to join.";
            leavingCall = true;
            if (socket) socket.close();
            if (localStream) localStream.getTracks().forEach(t => t.stop());
        }
    }

    // ---------- Video grid helpers ----------
    function makeTile(id, isLocal, name) {
        const tile = document.createElement("div");
        tile.className = "video-tile" + (isLocal ? " local" : "");
        tile.id = `tile-${id}`;

        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;

        const nameTag = document.createElement("div");
        nameTag.className = "name-tag";
        nameTag.textContent = name || (isLocal ? "You" : "Guest");

        tile.appendChild(video);
        tile.appendChild(nameTag);
        videoGrid.appendChild(tile);
        return video;
    }

    function addLocalTile() {
        const video = makeTile("local", true, displayName + " (You)");
        video.srcObject = localStream;
    }

    function removeTile(id) {
        const tile = document.getElementById(`tile-${id}`);
        if (tile) tile.remove();
    }

    // Some browsers (notably iOS Safari) silently refuse to autoplay a
    // stream with unmuted audio and never surface an error - the video just
    // stays black. Try unmuted playback; if it's blocked, fall back to muted
    // autoplay (always allowed) and let the user tap to unmute.
    function attachRemoteStream(peerId, stream) {
        const videoEl = peers[peerId].videoEl;
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {
            videoEl.muted = true;
            videoEl.play().catch(err => console.warn(`[peer ${peerId}] playback blocked`, err));
            addUnmuteButton(peerId);
        });
    }

    function addUnmuteButton(peerId) {
        const tile = document.getElementById(`tile-${peerId}`);
        if (!tile || tile.querySelector(".unmute-btn")) return;
        const btn = document.createElement("button");
        btn.className = "unmute-btn";
        btn.textContent = "🔇 Tap to unmute";
        btn.addEventListener("click", () => {
            const videoEl = peers[peerId] && peers[peerId].videoEl;
            if (videoEl) {
                videoEl.muted = false;
                videoEl.play().catch(() => {});
            }
            btn.remove();
        });
        tile.appendChild(btn);
    }

    // ---------- WebSocket signaling ----------
    let leavingCall = false;
    let reconnectAttempts = 0;

    function connectSocket() {
        socket = new WebSocket(`${WS_SCHEME}://${window.location.host}/ws/room/${ROOM_CODE}/`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            if (awaitingApproval) {
                send({ type: "join-request", client_id: CLIENT_ID, name: displayName });
            } else {
                send({ type: "join", client_id: CLIENT_ID, name: displayName });
            }
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.client_id === CLIENT_ID && data.type !== "chat") return;

            switch (data.type) {
                case "join":
                    await handlePeerJoin(data.client_id, data.name);
                    break;
                case "offer":
                    if (data.target === CLIENT_ID) await handleOffer(data);
                    break;
                case "answer":
                    if (data.target === CLIENT_ID) await handleAnswer(data);
                    break;
                case "ice-candidate":
                    if (data.target === CLIENT_ID) await handleIce(data);
                    break;
                case "leave":
                    handlePeerLeave(data.client_id);
                    break;
                case "chat":
                    appendChatMessage(data.name, data.message, data.client_id === CLIENT_ID);
                    break;
                case "join-request":
                    if (IS_HOST) showJoinRequest(data.client_id, data.name);
                    break;
                case "join-response":
                    if (data.target === CLIENT_ID) handleJoinResponse(data.accepted);
                    break;
            }
        };

        socket.onclose = () => {
            if (leavingCall) return;
            // Reconnect (e.g. the host spun back up after being idle) and
            // re-announce ourselves so peers who joined while we were
            // disconnected can still see us.
            const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
            reconnectAttempts++;
            setTimeout(connectSocket, delay);
        };
    }

    function send(payload) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    }

    // ---------- Peer connection management ----------
    function createPeerConnection(peerId) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                send({
                    type: "ice-candidate",
                    client_id: CLIENT_ID,
                    target: peerId,
                    candidate: event.candidate,
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[peer ${peerId}] ICE connection state: ${pc.iceConnectionState}`);
        };

        pc.ontrack = (event) => {
            if (!peers[peerId].videoEl) {
                peers[peerId].videoEl = makeTile(peerId, false, peers[peerId].name);
            }
            attachRemoteStream(peerId, event.streams[0]);
        };

        return pc;
    }

    // New peer announced itself -> we (existing peer) create an offer to them
    async function handlePeerJoin(peerId, name) {
        if (peers[peerId]) {
            // Peer re-announced itself (e.g. it reconnected after a drop) -
            // tear down the stale connection and renegotiate from scratch.
            if (peers[peerId].pc) peers[peerId].pc.close();
            removeTile(peerId);
        }
        peers[peerId] = { pc: null, videoEl: null, name };
        const pc = createPeerConnection(peerId);
        peers[peerId].pc = pc;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({
            type: "offer",
            client_id: CLIENT_ID,
            target: peerId,
            sdp: pc.localDescription,
            name: displayName,
        });
    }

    async function handleOffer(data) {
        const peerId = data.client_id;
        if (!peers[peerId]) {
            peers[peerId] = { pc: null, videoEl: null, name: data.name };
        }
        const pc = createPeerConnection(peerId);
        peers[peerId].pc = pc;

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({
            type: "answer",
            client_id: CLIENT_ID,
            target: peerId,
            sdp: pc.localDescription,
            name: displayName,
        });
    }

    async function handleAnswer(data) {
        const peer = peers[data.client_id];
        if (peer && peer.pc) {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
    }

    async function handleIce(data) {
        const peer = peers[data.client_id];
        if (peer && peer.pc) {
            try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.warn("Error adding ICE candidate", err);
            }
        }
    }

    function handlePeerLeave(peerId) {
        const peer = peers[peerId];
        if (peer) {
            if (peer.pc) peer.pc.close();
            removeTile(peerId);
            delete peers[peerId];
        }
    }

    // ---------- Controls ----------
    micBtn.addEventListener("click", () => {
        micOn = !micOn;
        localStream.getAudioTracks().forEach(t => t.enabled = micOn);
        micBtn.classList.toggle("active", micOn);
    });

    camBtn.addEventListener("click", () => {
        camOn = !camOn;
        localStream.getVideoTracks().forEach(t => t.enabled = camOn);
        camBtn.classList.toggle("active", camOn);
    });

    screenshareBtn.addEventListener("click", async () => {
        try {
            if (!screenSharing) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                replaceVideoTrack(screenTrack);
                screenTrack.onended = () => replaceVideoTrack(cameraTrack);
                screenSharing = true;
                screenshareBtn.classList.add("active");
            } else {
                replaceVideoTrack(cameraTrack);
                screenSharing = false;
                screenshareBtn.classList.remove("active");
            }
        } catch (err) {
            console.warn("Screen share cancelled/failed", err);
        }
    });

    function replaceVideoTrack(newTrack) {
        Object.values(peers).forEach(peer => {
            const sender = peer.pc && peer.pc.getSenders().find(s => s.track && s.track.kind === "video");
            if (sender) sender.replaceTrack(newTrack);
        });
        const localVideoEl = document.querySelector("#tile-local video");
        const newStream = new MediaStream([newTrack, ...localStream.getAudioTracks()]);
        if (localVideoEl) localVideoEl.srcObject = newStream;
    }

    leaveBtn.addEventListener("click", () => {
        leavingCall = true;
        send({ type: "leave", client_id: CLIENT_ID });
        Object.values(peers).forEach(p => p.pc && p.pc.close());
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        if (socket) socket.close();
        window.location.href = "/";
    });

    copyLinkBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            copyLinkBtn.textContent = "Link copied!";
            setTimeout(() => (copyLinkBtn.textContent = "Copy invite link"), 1500);
        });
    });

    // ---------- Chat ----------
    chatBtn.addEventListener("click", () => chatPanel.classList.toggle("hidden"));
    closeChatBtn.addEventListener("click", () => chatPanel.classList.add("hidden"));

    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (!message) return;
        send({ type: "chat", client_id: CLIENT_ID, name: displayName, message });
        chatInput.value = "";
    });

    function appendChatMessage(name, message, isSelf) {
        const div = document.createElement("div");
        div.className = "msg";
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = isSelf ? "You" : name;
        div.appendChild(who);
        div.appendChild(document.createTextNode(message));
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Clean up on tab close
    window.addEventListener("beforeunload", () => {
        send({ type: "leave", client_id: CLIENT_ID });
    });
})();
