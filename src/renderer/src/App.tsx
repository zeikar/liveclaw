import { useEffect, useRef, useState } from 'react'
import { Live2DPanel } from './components/Live2DPanel'
import { ChatComposer } from './components/chat/ChatComposer'
import { ChatHeader } from './components/chat/ChatHeader'
import { MessageList } from './components/chat/MessageList'
import { APP_CHARACTER } from './config/character'
import { useCharivo } from './hooks/useCharivo'

function App(): React.JSX.Element {
  const { messages, isLoading, isBusy, error, sendMessage, clearHistory } = useCharivo()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
      </div>

      <ChatHeader characterName={APP_CHARACTER.name} isBusy={isBusy} onClear={clearHistory} />

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <Live2DPanel />

        <MessageList
          messages={messages}
          characterName={APP_CHARACTER.name}
          isLoading={isLoading}
          error={error}
          messagesEndRef={messagesEndRef}
        />

        <ChatComposer
          characterName={APP_CHARACTER.name}
          input={input}
          isLoading={isLoading}
          isBusy={isBusy}
          onInputChange={setInput}
          onSend={handleSend}
          onKeyDown={handleKeyDown}
        />
      </main>
    </div>
  )
}

export default App
