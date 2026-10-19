import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpeechRecognitionConstructor, SpeechRecognitionLike } from './speech'

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许麦克风访问',
  'service-not-allowed': '浏览器禁止了语音识别服务',
  'audio-capture': '未检测到可用的麦克风',
  network: '语音服务连接失败，请检查网络后重试',
  'no-speech': '没有听到语音，请重试',
  'language-not-supported': '当前浏览器不支持中文语音识别',
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

/** 把一次听写结果追加到已有文本；已有内容与新增内容之间补一个空格 */
export function appendDictation(previous: string, text: string): string {
  const addition = text.trim()
  if (!addition) return previous
  if (!previous) return addition
  return /\s$/.test(previous) ? `${previous}${addition}` : `${previous} ${addition}`
}

interface UseSpeechInputOptions {
  lang?: string
  onFinal: (text: string) => void
}

export interface SpeechInput {
  supported: boolean
  listening: boolean
  interim: string
  error: string | null
  start: () => void
  stop: () => void
  /** 停止并丢弃尚未返回的结果；发送或卸载时使用 */
  cancel: () => void
  toggle: () => void
}

/**
 * 浏览器内置语音识别（Chrome / Safari）。音频由浏览器处理，ATP 不接触音频流。
 * 识别在本地还是浏览器服务端完成由浏览器决定；平台不接入第三方语音 API。
 */
export function useSpeechInput({ lang = 'zh-CN', onFinal }: UseSpeechInputOptions): SpeechInput {
  const [supported] = useState(() => recognitionConstructor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const discardRef = useRef(false)
  const onFinalRef = useRef(onFinal)

  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  const stop = useCallback(() => {
    discardRef.current = false
    recognitionRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    recognitionRef.current?.abort()
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionConstructor()
    if (!Ctor) return
    recognitionRef.current?.abort()
    discardRef.current = false
    setError(null)
    setInterim('')

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition || discardRef.current) return
      let finalText = ''
      let pending = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += transcript
        else pending += transcript
      }
      if (finalText.trim()) onFinalRef.current(finalText)
      setInterim(pending)
    }

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition || event.error === 'aborted') return
      setError(ERROR_TEXT[event.error] ?? `语音识别失败（${event.error}）`)
      setListening(false)
      setInterim('')
    }

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      setListening(false)
      setInterim('')
    }

    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
    }
  }, [lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  useEffect(
    () => () => {
      discardRef.current = true
      recognitionRef.current?.abort()
      recognitionRef.current = null
    },
    [],
  )

  return { supported, listening, interim, error, start, stop, cancel, toggle }
}
