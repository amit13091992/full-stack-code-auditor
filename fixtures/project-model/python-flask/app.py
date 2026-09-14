from flask import Flask

app = Flask(__name__)


def create_app():
    return app


class RequestHandler:
    def __init__(self, request):
        self.request = request

    def handle(self):
        return "ok"
