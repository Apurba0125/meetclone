import json

from channels.generic.websocket import AsyncWebsocketConsumer


class SignalingConsumer(AsyncWebsocketConsumer):
    """
    Relays WebRTC signaling messages (join/leave/offer/answer/ice-candidate)
    and simple chat/status messages between all clients in a room group.

    Every message is broadcast to the group. Messages that target a specific
    peer include a "target" client_id field; the frontend ignores messages
    not addressed to it (or to everyone, for join/leave/chat).
    """

    async def connect(self):
        self.room_code = self.scope["url_route"]["kwargs"]["room_code"]
        self.room_group_name = f"room_{self.room_code}"
        self.client_id = None

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.client_id:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "broadcast_message",
                    "message": {
                        "type": "leave",
                        "client_id": self.client_id,
                    },
                },
            )
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)

        if data.get("type") == "join":
            self.client_id = data.get("client_id")

        # Relay to everyone in the room (including sender; client filters by target/id)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "broadcast_message",
                "message": data,
            },
        )

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event["message"]))
