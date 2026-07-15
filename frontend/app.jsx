import { useState, useRef, useEffect } from "react";

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "🐧 PenguinAI online. Ask me anything."
    }
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const bottomRef = useRef(null);

  // auto scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    setError(null);

    const userMessage = {
      role: "user",
      content: input.trim()
    };

    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: updatedMessages.slice(-20)
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      const aiMessage = {
        role: "assistant",
        content: data.reply || "🐧 No response"
      };

      setMessages(prev => [...prev, aiMessage]);

    } catch (err) {
      console.error("Chat error:", err);

      setError(err.message);

      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: "🐧 Error: " + err.message
        }