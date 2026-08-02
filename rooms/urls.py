from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("room/<str:room_code>/", views.room, name="room"),
    path("room/<str:room_code>/settings/", views.room_settings, name="room_settings"),
    path("room/<str:room_code>/verify-password/", views.verify_password, name="verify_password"),
]
