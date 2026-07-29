"""Django endpoint for a consolidated, immediately downloaded health report."""

from __future__ import annotations

from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.template.loader import render_to_string
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from f5_automation.health.health_adapter import F5HealthAdapter
from f5_automation.health.health_ai_service import analyze_with_fallback

from .models import BigIpConfig


def _address(device: BigIpConfig) -> str:
    for field in ("management_ip", "ip_address", "host", "hostname"):
        value = getattr(device, field, None)
        if value:
            return str(value)
    raise ValueError(f"BIG-IP {device.pk} não possui endereço de gerenciamento")


@login_required
@require_http_methods(["GET", "POST"])
def health(request: HttpRequest) -> HttpResponse:
    devices = BigIpConfig.objects.all().order_by("pk")
    if request.method == "GET":
        return render(request, "catalog/health.html", {"devices": devices})

    selected_ids = request.POST.getlist("devices")
    username = request.POST.get("username", "").strip()
    password = request.POST.get("password", "")
    if not selected_ids or not username or not password:
        return render(request, "catalog/health.html", {
            "devices": devices,
            "error": "Selecione ao menos um BIG-IP e informe as credenciais temporárias.",
        }, status=400)

    selected = list(devices.filter(pk__in=selected_ids))
    results = []
    for device in selected:
        address = _address(device)
        try:
            snapshot = F5HealthAdapter(
                address,
                username,
                password,
                verify_tls=getattr(device, "verify_tls", True),
            ).collect()
            snapshot["address"] = address
            results.append(snapshot)
        except Exception as exc:  # isolated appliance failure must not abort the fleet report
            results.append({"hostname": str(device), "address": address, "error": str(exc), "log_alerts": []})

    ai_analysis = analyze_with_fallback(results)
    for result in results:
        result["ai_diagnostic"] = ai_analysis["device_diagnostics"].get(
            str(result.get("hostname") or result.get("address", "")), ""
        )
    context = {
        "report": True,
        "generated_at": timezone.localtime(),
        "results": results,
        "ai_analysis": ai_analysis,
        "action_plan": ai_analysis["action_plan"],
    }
    html = render_to_string("catalog/health_report.html", context, request=request)
    from weasyprint import HTML

    pdf = HTML(string=html, base_url=request.build_absolute_uri("/")).write_pdf()
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="saude-f5.pdf"'
    response["Cache-Control"] = "no-store"
    return response
