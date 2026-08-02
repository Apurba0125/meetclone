import random
import string

from django.shortcuts import render, redirect
from django.views.decorators.http import require_http_methods

from .models import Room


def _generate_room_code():
    """Generate a Google-Meet-style code: abc-defg-hij"""
    def chunk(n):
        return ''.join(random.choices(string.ascii_lowercase, k=n))
    return f"{chunk(3)}-{chunk(4)}-{chunk(3)}"


@require_http_methods(["GET", "POST"])
def home(request):
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "new":
            code = _generate_room_code()
            while Room.objects.filter(code=code).exists():
                code = _generate_room_code()
            Room.objects.create(code=code)
            return redirect("room", room_code=code)
        elif action == "join":
            code = request.POST.get("room_code", "").strip().lower()
            if code:
                Room.objects.get_or_create(code=code)
                return redirect("room", room_code=code)
    return render(request, "rooms/home.html")


def room(request, room_code):
    room_obj, _ = Room.objects.get_or_create(code=room_code)
    display_name = request.GET.get("name", "Guest")
    return render(request, "rooms/room.html", {
        "room_code": room_obj.code,
        "display_name": display_name,
    })
