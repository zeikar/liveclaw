import { useEffect, useRef, useState } from 'react'
import { useCharivo } from './hooks/useCharivo'

function App(): React.JSX.Element {
  const { messages, isLoading, error, sendMessage, clearHistory } = useCharivo()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">LiveClaw</span>
        <button className="clear-btn" onClick={clearHistory} disabled={isLoading}>
          Clear
        </button>
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-state">Say something to get started!</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.type}`}>
            <span className="message-role">{msg.type === 'user' ? 'You' : 'Assistant'}</span>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
        {isLoading && (
          <div className="message message-character">
            <span className="message-role">Assistant</span>
            <p className="message-content typing">...</p>
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <input
          className="input"
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button className="send-btn" onClick={handleSend} disabled={isLoading || !input.trim()}>
          Send
        </button>
      </footer>
    </div>
  )
}

export default App
