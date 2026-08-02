# MeetClone — Django + WebRTC video calling app

A Google-Meet-style video conferencing app built with:
- **Django** for the web app / room management
- **Django Channels** (WebSockets) for WebRTC signaling
- **Plain WebRTC (RTCPeerConnection)** on the frontend for peer-to-peer audio/video (mesh topology)

## Features
- Create a new meeting (auto-generated room code like `abc-defg-hij`) or join with a code
- Pre-join screen with camera/mic preview and toggles
- Multi-participant video grid (mesh WebRTC — good for small groups, e.g. 2–6 people)
- Mute/unmute mic, turn camera on/off
- Screen sharing (replaces your camera track for everyone)
- In-call text chat
- Copy invite link
- Leave call

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

python manage.py migrate
python manage.py runserver
```

Open http://127.0.0.1:8000 in **two different browser tabs/windows (or two devices)**
to test a call — a single tab can't call itself.

> Because it uses Django Channels, `manage.py runserver` automatically runs
> as an ASGI server (Daphne) so both normal HTTP pages and the `ws://.../ws/room/<code>/`
> signaling socket work out of the box. No separate process needed for local dev.

## How it works

1. `rooms/views.py` — creates/looks up a `Room` by code and renders the room page.
2. `rooms/consumers.py` — a Channels `AsyncWebsocketConsumer` that joins a
   per-room group and relays signaling messages (`join`, `offer`, `answer`,
   `ice-candidate`, `leave`, `chat`) to everyone in that room.
3. `rooms/static/rooms/js/room.js` — the frontend WebRTC logic:
   - Grabs your camera/mic with `getUserMedia`
   - On join, broadcasts a `join` message; every existing peer creates an
     `RTCPeerConnection`, sends you an `offer`; you `answer`; ICE candidates
     are exchanged over the same socket.
   - Renders a `<video>` tile per participant.

## Notes for production

- `CHANNEL_LAYERS` currently uses `InMemoryChannelLayer`, which only works
  with a **single process**. For multiple workers/servers, switch to
  [`channels_redis`](https://github.com/django/channels_redis) and run Redis.
- WebRTC uses only public **STUN** servers (`stun.l.google.com`). This works
  for most networks, but for strict corporate NATs/firewalls you'll likely
  need a **TURN** server (e.g. coturn, or a hosted TURN provider) for
  reliable connectivity.
- Mesh WebRTC (every peer connects to every peer) works well for small
  calls. For larger calls (10+), you'd want an SFU (e.g. mediasoup, LiveKit,
  Janus) instead of direct mesh.
- Add authentication (Django's built-in auth, or your SSO) before deploying
  publicly, and put this behind HTTPS/WSS (required by browsers for camera
  access on non-localhost origins).
