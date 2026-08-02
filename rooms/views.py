import random
import string

from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.views.decorators.http import require_http_methods, require_POST

from .models import Room


def _generate_room_code():
    """Generate a Google-Meet-style code: abc-defg-hij"""
    def chunk(n):
        return ''.join(random.choices(string.ascii_lowercase, k=n))
    return f"{chunk(3)}-{chunk(4)}-{chunk(3)}"


def _host_session_key(room_code):
    return f"host_of_{room_code}"


@require_http_methods(["GET", "POST"])
def home(request):
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "new":
            code = _generate_room_code()
            while Room.objects.filter(code=code).exists():
                code = _generate_room_code()
            Room.objects.create(code=code)
            request.session[_host_session_key(code)] = True
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
    is_host = bool(request.session.get(_host_session_key(room_code)))
    return render(request, "rooms/room.html", {
        "room_code": room_obj.code,
        "display_name": display_name,
        "is_host": is_host,
        "require_approval": room_obj.require_approval,
        "has_password": bool(room_obj.password_hash),
    })


@require_POST
def room_settings(request, room_code):
    room_obj, _ = Room.objects.get_or_create(code=room_code)
    if not request.session.get(_host_session_key(room_code)):
        return JsonResponse({"ok": False, "error": "Only the host can change meeting settings."}, status=403)

    room_obj.require_approval = request.POST.get("require_approval") == "true"
    password = request.POST.get("password", "")
    room_obj.set_password(password)
    room_obj.save()
    return JsonResponse({
        "ok": True,
        "require_approval": room_obj.require_approval,
        "has_password": bool(room_obj.password_hash),
    })


@require_POST
def verify_password(request, room_code):
    room_obj, _ = Room.objects.get_or_create(code=room_code)
    password = request.POST.get("password", "")
    return JsonResponse({"ok": room_obj.check_password(password)})
