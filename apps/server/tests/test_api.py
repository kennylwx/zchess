from chess_server.main import board_from, apply_verified

def test_applies_verified_move():
    result = apply_verified(board_from("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), "e2e4", "test")
    assert result.move == "e2e4"
    assert "4P3" in result.fen

import json

import chess
import httpx
import pytest
from fastapi import HTTPException
from chess_server.main import ResolveRequest, resolve


def mock_provider(monkeypatch, handler):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.delenv("TYPESAFE_MODEL", raising=False)
    monkeypatch.delenv("TYPESAFE_BASE_URL", raising=False)
    client_class = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client_class(
        transport=httpx.MockTransport(handler), **kwargs
    ))


@pytest.mark.asyncio
async def test_resolve_uses_typesafe_choice_api(monkeypatch):
    def provider(request):
        assert str(request.url) == "https://api.typesafe.ai/v1/systemone"
        assert request.headers["Authorization"] == "Bearer test-key"
        payload = json.loads(request.content)
        assert payload["model"] == "jev-latest"
        assert payload["state"]["instruction"] == "move the pawn from e2 to e4"
        question = payload["questions"]["move"]
        assert question["type"] == "choice"
        assert question["criteria"]["e2e4"] == "e4"
        assert set(question["criteria"]) == {m.uci() for m in chess.Board().legal_moves} | {"no_match"}
        return httpx.Response(200, json={"answers": {"move": {"type": "choice", "choice": "e2e4", "confidence": 0.99}}})

    mock_provider(monkeypatch, provider)
    result = await resolve(ResolveRequest(instruction="move the pawn from e2 to e4", fen=chess.STARTING_FEN))
    assert result.move == "e2e4"
    assert chess.Board(result.fen).piece_at(chess.E4) == chess.Piece(chess.PAWN, chess.WHITE)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{}, {"answers": {"move": {"choice": "e2e5"}}}, {"answers": {"move": {"choice": []}}}])
async def test_resolve_rejects_invalid_provider_answers(monkeypatch, body):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=body))
    with pytest.raises(HTTPException) as error:
        await resolve(ResolveRequest(instruction="move a pawn", fen=chess.STARTING_FEN))
    assert error.value.status_code == 502


@pytest.mark.asyncio
async def test_resolve_reports_actionable_404_without_provider_body(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(404, text="sensitive provider details"))
    with pytest.raises(HTTPException) as error:
        await resolve(ResolveRequest(instruction="move a pawn", fen=chess.STARTING_FEN))
    assert error.value.status_code == 502
    assert "TYPESAFE_MODEL" in error.value.detail
    assert "sensitive" not in error.value.detail


@pytest.mark.asyncio
async def test_unmatched_instruction_does_not_substitute_a_move(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json={"answers": {"move": {"choice": "no_match"}}}))
    with pytest.raises(HTTPException) as error:
        await resolve(ResolveRequest(instruction="my pawn takes the queen", fen=chess.STARTING_FEN))
    assert error.value.status_code == 422
    assert "exact notation" in error.value.detail


@pytest.mark.asyncio
async def test_uncertain_move_requires_clarification(monkeypatch):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json={"answers": {"move": {"choice": "e2e4", "confidence": 0.6}}}))
    with pytest.raises(HTTPException) as error:
        await resolve(ResolveRequest(instruction="move that pawn", fen=chess.STARTING_FEN))
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_missing_provider_configuration_is_not_a_move_matching_failure(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(HTTPException) as error:
        await resolve(ResolveRequest(instruction="pawn to e4", fen=chess.STARTING_FEN))
    assert error.value.status_code == 503
    assert error.value.detail == "TYPESAFE_API_KEY is not configured"
