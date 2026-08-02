from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class Room(models.Model):
    code = models.CharField(max_length=20, unique=True, db_index=True)
    name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    password_hash = models.CharField(max_length=128, blank=True, default="")
    require_approval = models.BooleanField(default=False)

    def __str__(self):
        return self.code

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password) if raw_password else ""

    def check_password(self, raw_password):
        if not self.password_hash:
            return True
        return check_password(raw_password or "", self.password_hash)
