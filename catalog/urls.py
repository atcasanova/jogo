from django.urls import path

from .views_health import health

app_name = "catalog"

urlpatterns = [
    path("saude/", health, name="health"),
]
