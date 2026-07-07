"""Chat API — AI conversational assistant with tool-calling."""

import json
from datetime import datetime

from flask import Blueprint, Response, jsonify, request
from sqlalchemy import desc

from core.logging import get_logger
from database import SessionLocal
from models import ChatMessage, ChatSession
from services.ai_agent import get_ai_agent

logger = get_logger(__name__)

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")


# ==================== 会话管理 ====================


@chat_bp.route("/sessions", methods=["GET"])
def list_sessions():
    db = SessionLocal()
    try:
        sessions = db.query(ChatSession).order_by(desc(ChatSession.updated_time)).limit(50).all()
        return jsonify(
            {
                "data": [
                    {
                        "id": s.id,
                        "title": s.title,
                        "created_time": s.created_time.isoformat() if s.created_time else None,
                        "updated_time": s.updated_time.isoformat() if s.updated_time else None,
                    }
                    for s in sessions
                ]
            }
        )
    finally:
        db.close()


@chat_bp.route("/sessions", methods=["POST"])
def create_session():
    db = SessionLocal()
    try:
        session = ChatSession()
        db.add(session)
        db.commit()
        return jsonify(
            {
                "data": {
                    "id": session.id,
                    "title": session.title,
                    "created_time": session.created_time.isoformat() if session.created_time else None,
                    "updated_time": session.updated_time.isoformat() if session.updated_time else None,
                }
            }
        ), 201
    finally:
        db.close()


@chat_bp.route("/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    db = SessionLocal()
    try:
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            return jsonify({"error": "会话不存在"}), 404
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        db.delete(session)
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@chat_bp.route("/sessions/<int:session_id>", methods=["PATCH"])
def update_session_title(session_id):
    db = SessionLocal()
    try:
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        if not title:
            return jsonify({"error": "标题不能为空"}), 400
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            return jsonify({"error": "会话不存在"}), 404
        session.title = title
        session.updated_time = datetime.now()
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ==================== 消息管理 ====================


@chat_bp.route("/sessions/<int:session_id>/messages", methods=["GET"])
def get_messages(session_id):
    db = SessionLocal()
    try:
        messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.id).all()
        return jsonify(
            {
                "data": [
                    {
                        "id": m.id,
                        "role": m.role,
                        "content": m.content,
                        "tool_name": m.tool_name,
                        "tool_params_json": m.tool_params_json,
                        "created_time": m.created_time.isoformat() if m.created_time else None,
                    }
                    for m in messages
                ]
            }
        )
    finally:
        db.close()


# ==================== 对话（SSE 流式） ====================


@chat_bp.route("", methods=["POST"])
def chat():
    """Send a message to the AI assistant. Returns SSE stream."""
    data = request.get_json() or {}
    session_id = data.get("session_id")
    user_message = data.get("message", "").strip()
    preferred_skill = data.get("skill")

    if not user_message:
        return jsonify({"error": "消息不能为空"}), 400

    db = SessionLocal()
    try:
        if session_id:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if not session:
                return jsonify({"error": "会话不存在"}), 404
        else:
            session = ChatSession()
            db.add(session)
            db.commit()
            session_id = session.id

        # Save user message
        user_msg = ChatMessage(session_id=session_id, role="user", content=user_message)
        db.add(user_msg)

        # Load message history (last 30 messages for context)
        history = (
            db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.id).limit(30).all()
        )

        openai_messages = []
        for m in history:
            openai_messages.append({"role": m.role, "content": m.content or ""})

        # Update session timestamp
        session.updated_time = datetime.now()
        db.commit()
    except Exception as e:
        db.close()
        logger.error(f"Chat setup failed: {e}")
        return jsonify({"error": f"对话初始化失败: {str(e)}"}), 500

    agent = get_ai_agent()

    def generate():
        assistant_content = ""
        tool_calls_log: list[dict] = []
        session_id_val = session_id

        try:
            for event in agent.chat(openai_messages, skill_name=preferred_skill):
                yield event

                if event.startswith("event: token"):
                    try:
                        data_json = json.loads(event.split("\n", 1)[1].removeprefix("data: "))
                        assistant_content += data_json.get("token", "")
                    except (json.JSONDecodeError, IndexError):
                        pass
                elif event.startswith("event: tool_start"):
                    try:
                        data_json = json.loads(event.split("\n", 1)[1].removeprefix("data: "))
                        tool_calls_log.append(
                            {
                                "name": data_json.get("name"),
                                "params": data_json.get("params"),
                                "tool_call_id": data_json.get("tool_call_id"),
                            }
                        )
                    except (json.JSONDecodeError, IndexError):
                        pass
        finally:
            _save_assistant_message(session_id_val, assistant_content, tool_calls_log)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _save_assistant_message(session_id: int, content: str, tool_calls: list[dict]):
    """Save the assistant's response to the database."""
    if not content and not tool_calls:
        return
    db = SessionLocal()
    try:
        msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=content or "",
            tool_name=json.dumps([t.get("name") for t in tool_calls], ensure_ascii=False) if tool_calls else None,
            tool_params_json=json.dumps(
                [{"name": t.get("name"), "params": t.get("params")} for t in tool_calls], ensure_ascii=False
            )
            if tool_calls
            else None,
        )
        db.add(msg)

        # Auto-generate title from first message
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if session and session.title == "新对话" and content:
            session.title = content[:40] + ("..." if len(content) > 40 else "")
            session.updated_time = datetime.now()

        db.commit()
    except Exception as e:
        logger.error(f"Failed to save assistant message: {e}")
    finally:
        db.close()
