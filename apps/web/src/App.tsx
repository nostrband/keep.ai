import React, { useState } from "react";
import { useThreadMessages } from "./hooks/dbReads";
import { useAddMessage } from "./hooks/dbWrites";
import { useCRSqliteQuery } from "./QueryProvider";

function App() {
  const [inputValue, setInputValue] = useState("");
  const { dbStatus, error } = useCRSqliteQuery();

  // Use 'main' thread for the homepage
  const { data: messages = [], isLoading } = useThreadMessages("main", "cli-user");
  const addMessage = useAddMessage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    addMessage.mutate({
      threadId: "main",
      role: "user",
      content: inputValue.trim(),
    });

    setInputValue("");
  };

  if (dbStatus === "initializing") {
    return <div className="App">Initializing database...</div>;
  }

  if (dbStatus === "error") {
    return <div className="App">Database error: {error}</div>;
  }

  return (
    <div
      className="App"
      style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}
    >
      <h1>Keep.ai Chat Prototype</h1>

      {/* Messages List */}
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "8px",
          height: "400px",
          overflowY: "auto",
          padding: "16px",
          marginBottom: "16px",
          backgroundColor: "#f9f9f9",
          color: "#000",
        }}
      >
        {isLoading ? (
          <div>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div style={{ color: "#666" }}>
            No messages yet. Start a conversation!
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                marginBottom: "12px",
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor:
                  message.role === "user" ? "#e3f2fd" : "#f5f5f5",
                marginLeft: message.role === "user" ? "20%" : "0",
                marginRight: message.role === "user" ? "0" : "20%",
              }}
            >
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                {message.role} •{" "}
                {new Date(message.created_at).toLocaleTimeString()}
              </div>
              <div>{message.content}</div>
            </div>
          ))
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type your message..."
          style={{
            flex: 1,
            padding: "12px",
            border: "1px solid #ccc",
            borderRadius: "6px",
            fontSize: "14px",
          }}
          disabled={addMessage.isPending}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || addMessage.isPending}
          style={{
            padding: "12px 24px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          {addMessage.isPending ? "Sending..." : "Send"}
        </button>
      </form>

      {/* Status */}
      <div style={{ marginTop: "16px", fontSize: "12px", color: "#666" }}>
        Database Status: {dbStatus} | Messages: {messages.length}
      </div>
    </div>
  );
}

export default App;
