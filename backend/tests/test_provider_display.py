"""providers/display.py: what the endpoint and the CLI may print of a stored endpoint."""
import pytest

from providers.display import safe_endpoint


@pytest.mark.parametrize(
    ("raw", "shown"),
    [
        ("https://host.example/api;jsessionid=SECRET/v1", "https://host.example/api"),  # path parameters can carry a token
        ("https://host.example/hooks;key=SECRET", "https://host.example/hooks"),
        ("http://localhost:0/x", "http://localhost:0/x"),  # port 0 is a port: it is not dropped
        ("https://host.example:443/v1", "https://host.example:443/v1"),
    ],
)
def test_safe_endpoint_cuts_path_parameters_and_keeps_every_port(raw, shown):
    assert safe_endpoint(raw) == shown
