'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, Volume2, Settings, RefreshCw, CheckCircle, XCircle, AlertCircle,
  Play, Square, Upload, Download, Globe, Zap, Activity,
  Languages, Clock, Gauge, Server, Sliders, TestTube, FileAudio,
  Brain, Waves, Radio, Speaker, Sparkles, User, Timer, Cpu
} from 'lucide-react';

// ============================================================================
// CONFIGURATION - Enhanced Voice Stack (mangwale-voice-v2)
// ============================================================================

// Mercury Voice Server URLs
const MERCURY_IP = process.env.NEXT_PUBLIC_MERCURY_IP || '192.168.0.151';
const ASR_URL = `http://${MERCURY_IP}:7001`;
const TTS_URL = `http://${MERCURY_IP}:7002`;
const ORCHESTRATOR_URL = `http://${MERCURY_IP}:7000`;

// Jupiter LLM Server
const JUPITER_IP = process.env.NEXT_PUBLIC_JUPITER_IP || '192.168.0.156';
const LLM_URL = `http://${JUPITER_IP}:8002`;

// ============================================================================
// TYPES
// ============================================================================

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'offline';
  latency: number;
  model?: string;
  device?: string;
  provider?: string;
  details?: Record<string, any>;
}

interface VoiceStackStatus {
  asr: ServiceStatus;
  tts: ServiceStatus;
  orchestrator: ServiceStatus;
  llm: ServiceStatus;
  gpu: {
    name: string;
    memoryUsed: number;
    memoryTotal: number;
    utilization: number;
  };
}

// ============================================================================
// MODELS CONFIGURATION - AI4Bharat Enhanced
// ============================================================================

// ASR Models
const ASR_MODELS = [
  { id: 'distil-large-v3', name: 'Distil Whisper Large v3', provider: 'faster-whisper', speed: 'fast', quality: 'high' },
  { id: 'large-v3-turbo', name: 'Whisper Large v3 Turbo', provider: 'faster-whisper', speed: 'medium', quality: 'highest' },
  { id: 'indicconformer', name: 'AI4Bharat IndicConformer', provider: 'ai4bharat', speed: 'fast', quality: 'native-indic' },
];

// TTS Models  
const TTS_MODELS = [
  { id: 'indic-parler', name: 'AI4Bharat Indic-Parler-TTS', provider: 'ai4bharat', languages: ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or'] },
  { id: 'kokoro', name: 'Kokoro TTS', provider: 'kokoro', languages: ['en'] },
];

// Supported Languages
const LANGUAGES = [
  { code: 'hi', name: 'Hindi', native: 'हिंदी', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', flag: '🇮🇳' },
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
];

// TTS Voices by Language
const TTS_VOICES: Record<string, { id: string; name: string; gender: string }[]> = {
  hi: [
    { id: 'default', name: 'Default Hindi', gender: 'female' },
    { id: 'ananya', name: 'Ananya', gender: 'female' },
  ],
  mr: [
    { id: 'default', name: 'Default Marathi', gender: 'female' },
  ],
  en: [
    { id: 'af_heart', name: 'Heart (American)', gender: 'female' },
    { id: 'af_bella', name: 'Bella (American)', gender: 'female' },
    { id: 'am_adam', name: 'Adam (American)', gender: 'male' },
    { id: 'bf_emma', name: 'Emma (British)', gender: 'female' },
    { id: 'bm_george', name: 'George (British)', gender: 'male' },
  ],
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function VoiceAIPageV2() {
  // Status State
  const [status, setStatus] = useState<VoiceStackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'overview' | 'asr' | 'tts' | 'pipeline' | 'settings'>('overview');
  
  // ASR Test State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [asrLatency, setAsrLatency] = useState<number | null>(null);
  const [selectedAsrLanguage, setSelectedAsrLanguage] = useState('hi');
  
  // TTS Test State
  const [ttsText, setTtsText] = useState('नमस्ते, मैं मंगवाले का AI असिस्टेंट हूँ। आज मैं आपकी कैसे मदद कर सकता हूँ?');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [ttsLatency, setTtsLatency] = useState<number | null>(null);
  const [selectedTtsLanguage, setSelectedTtsLanguage] = useState('hi');
  const [selectedVoice, setSelectedVoice] = useState('default');
  
  // Pipeline Test State
  const [pipelineInput, setPipelineInput] = useState('');
  const [pipelineResponse, setPipelineResponse] = useState('');
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [pipelineLatencies, setPipelineLatencies] = useState<{ asr: number; llm: number; tts: number; total: number } | null>(null);
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ============================================================================
  // STATUS LOADING
  // ============================================================================

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    const results: Partial<VoiceStackStatus> = {};
    
    // Check ASR
    try {
      const start = Date.now();
      const res = await fetch(`${ASR_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        results.asr = {
          name: 'ASR Service',
          status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          latency: Date.now() - start,
          model: data.model || 'distil-whisper-large-v3',
          device: data.device || 'cuda',
          provider: 'faster-whisper',
          details: data,
        };
      }
    } catch (e) {
      results.asr = { name: 'ASR Service', status: 'offline', latency: 0 };
    }
    
    // Check TTS
    try {
      const start = Date.now();
      const res = await fetch(`${TTS_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        results.tts = {
          name: 'TTS Service',
          status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          latency: Date.now() - start,
          model: 'indic-parler-tts',
          device: data.device || 'cuda',
          provider: 'ai4bharat',
          details: data,
        };
      }
    } catch (e) {
      results.tts = { name: 'TTS Service', status: 'offline', latency: 0 };
    }
    
    // Check Orchestrator
    try {
      const start = Date.now();
      const res = await fetch(`${ORCHESTRATOR_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        results.orchestrator = {
          name: 'Orchestrator',
          status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          latency: Date.now() - start,
          details: data,
        };
      }
    } catch (e) {
      results.orchestrator = { name: 'Orchestrator', status: 'offline', latency: 0 };
    }
    
    // Check Jupiter LLM
    try {
      const start = Date.now();
      const res = await fetch(`${LLM_URL}/v1/models`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        results.llm = {
          name: 'Jupiter vLLM',
          status: 'healthy',
          latency: Date.now() - start,
          model: data.data?.[0]?.id || 'Qwen2.5-7B-AWQ',
          provider: 'vllm',
        };
      }
    } catch (e) {
      results.llm = { name: 'Jupiter vLLM', status: 'offline', latency: 0 };
    }
    
    // GPU Info (would need backend endpoint)
    results.gpu = {
      name: 'NVIDIA RTX 3060',
      memoryUsed: 5.7,
      memoryTotal: 12,
      utilization: 48,
    };
    
    setStatus(results as VoiceStackStatus);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // ============================================================================
  // ASR FUNCTIONS
  // ============================================================================

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async () => {
    if (!audioBlob) return;
    
    setIsTranscribing(true);
    const startTime = Date.now();
    
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      formData.append('language', selectedAsrLanguage);
      
      const response = await fetch(`${ASR_URL}/transcribe`, {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      setAsrLatency(Date.now() - startTime);
      setTranscription(result.text || result.transcription || 'No transcription');
    } catch (error) {
      console.error('Transcription failed:', error);
      setTranscription('Transcription error');
    } finally {
      setIsTranscribing(false);
    }
  };

  // ============================================================================
  // TTS FUNCTIONS
  // ============================================================================

  const generateSpeech = async () => {
    if (!ttsText.trim()) return;
    
    setIsGenerating(true);
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${TTS_URL}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsText,
          language: selectedTtsLanguage,
          voice: selectedVoice,
        }),
      });
      
      if (response.ok) {
        const blob = await response.blob();
        setTtsLatency(Date.now() - startTime);
        
        if (ttsAudioUrl) URL.revokeObjectURL(ttsAudioUrl);
        setTtsAudioUrl(URL.createObjectURL(blob));
      }
    } catch (error) {
      console.error('TTS failed:', error);
      alert('Failed to generate speech');
    } finally {
      setIsGenerating(false);
    }
  };

  // ============================================================================
  // PIPELINE TEST
  // ============================================================================

  const runPipelineTest = async () => {
    setIsPipelineRunning(true);
    setPipelineResponse('');
    setPipelineLatencies(null);
    
    const latencies = { asr: 0, llm: 0, tts: 0, total: 0 };
    const totalStart = Date.now();
    
    try {
      // Step 1: Generate TTS from input (simulating voice input)
      const ttsStart = Date.now();
      const ttsResponse = await fetch(`${TTS_URL}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pipelineInput || 'नमस्ते, मुझे एक ऑर्डर देना है',
          language: 'hi',
        }),
      });
      latencies.tts = Date.now() - ttsStart;
      
      // Step 2: Transcribe the audio
      if (ttsResponse.ok) {
        const audioBlob = await ttsResponse.blob();
        const formData = new FormData();
        formData.append('file', audioBlob, 'test.wav');
        formData.append('language', 'hi');
        
        const asrStart = Date.now();
        const asrResponse = await fetch(`${ASR_URL}/transcribe`, {
          method: 'POST',
          body: formData,
        });
        latencies.asr = Date.now() - asrStart;
        
        const asrResult = await asrResponse.json();
        
        // Step 3: Get LLM response
        const llmStart = Date.now();
        const llmResponse = await fetch(`${LLM_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'Qwen/Qwen2.5-7B-Instruct-AWQ',
            messages: [
              { role: 'system', content: 'You are a helpful Hindi assistant for Mangwale food ordering. Reply in Hindi, be concise.' },
              { role: 'user', content: asrResult.text || pipelineInput },
            ],
            max_tokens: 150,
            temperature: 0.7,
          }),
        });
        latencies.llm = Date.now() - llmStart;
        
        const llmResult = await llmResponse.json();
        setPipelineResponse(llmResult.choices?.[0]?.message?.content || 'No response');
      }
      
      latencies.total = Date.now() - totalStart;
      setPipelineLatencies(latencies);
    } catch (error) {
      console.error('Pipeline test failed:', error);
      setPipelineResponse('Pipeline error: ' + (error as Error).message);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // ============================================================================
  // UI COMPONENTS
  // ============================================================================

  const StatusBadge = ({ status }: { status: 'healthy' | 'unhealthy' | 'offline' }) => {
    const colors = {
      healthy: 'bg-green-100 text-green-800 border-green-300',
      unhealthy: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      offline: 'bg-red-100 text-red-800 border-red-300',
    };
    const icons = {
      healthy: <CheckCircle className="w-4 h-4" />,
      unhealthy: <AlertCircle className="w-4 h-4" />,
      offline: <XCircle className="w-4 h-4" />,
    };
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border ${colors[status]}`}>
        {icons[status]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const ServiceCard = ({ service }: { service: ServiceStatus }) => (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{service.name}</h3>
        <StatusBadge status={service.status} />
      </div>
      <div className="space-y-2 text-sm text-gray-600">
        {service.model && (
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            <span>{service.model}</span>
          </div>
        )}
        {service.provider && (
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            <span>{service.provider}</span>
          </div>
        )}
        {service.device && (
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            <span>{service.device}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4" />
          <span>{service.latency}ms ping</span>
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Waves className="w-7 h-7 text-purple-600" />
              Voice AI Stack
            </h1>
            <p className="text-gray-600 mt-1">
              AI4Bharat Enhanced • Mercury GPU Server
            </p>
          </div>
          <button
            onClick={() => loadStatus()}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'asr', label: 'ASR Test', icon: Mic },
            { id: 'tts', label: 'TTS Test', icon: Volume2 },
            { id: 'pipeline', label: 'Pipeline', icon: Zap },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && status && (
          <div className="space-y-6">
            {/* Services Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <ServiceCard service={status.asr} />
              <ServiceCard service={status.tts} />
              <ServiceCard service={status.orchestrator} />
              <ServiceCard service={status.llm} />
            </div>

            {/* GPU Status */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-green-600" />
                GPU Status
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">{status.gpu.name}</span>
                <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${(status.gpu.memoryUsed / status.gpu.memoryTotal) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium">
                  {status.gpu.memoryUsed.toFixed(1)} / {status.gpu.memoryTotal} GB
                </span>
              </div>
            </div>

            {/* Architecture Overview */}
            <div className="bg-white rounded-lg border shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">System Architecture</h3>
              <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 overflow-x-auto">
                <pre>{`
┌─────────────────────────────────────────────────────────────────────┐
│                    MANGWALE VOICE STACK v2                          │
│                    AI4Bharat Enhanced Edition                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   MERCURY (192.168.0.151)              JUPITER (192.168.0.156)     │
│   ┌─────────────────────┐              ┌─────────────────────┐     │
│   │     RTX 3060        │              │     vLLM Server     │     │
│   │     12GB VRAM       │    Network   │   Qwen2.5-7B-AWQ    │     │
│   │                     │◄────────────►│     Port: 8002      │     │
│   │  ┌───────────────┐  │              └─────────────────────┘     │
│   │  │ ASR (7001)    │  │                                          │
│   │  │ Whisper       │  │   Smart Routing:                         │
│   │  │ distil-v3     │  │   • Hindi/Marathi → Indic-Parler         │
│   │  └───────────────┘  │   • English → Kokoro                     │
│   │                     │   • Mixed → Auto-detect                  │
│   │  ┌───────────────┐  │                                          │
│   │  │ TTS (7002)    │  │   Performance:                           │
│   │  │ Indic-Parler  │  │   • ASR: ~400ms                          │
│   │  │ + Kokoro      │  │   • TTS: ~4s                             │
│   │  └───────────────┘  │   • LLM: ~1.5s                           │
│   │                     │   • Total: ~6s                           │
│   │  ┌───────────────┐  │                                          │
│   │  │ Orchestrator  │  │                                          │
│   │  │ (7000)        │  │                                          │
│   │  └───────────────┘  │                                          │
│   └─────────────────────┘                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ASR Test Tab */}
        {activeTab === 'asr' && (
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Mic className="w-5 h-5 text-purple-600" />
              Speech Recognition Test
            </h3>
            
            <div className="space-y-4">
              {/* Language Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                <select
                  value={selectedAsrLanguage}
                  onChange={(e) => setSelectedAsrLanguage(e.target.value)}
                  className="w-full md:w-64 border rounded-lg px-3 py-2"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name} ({lang.native})
                    </option>
                  ))}
                </select>
              </div>

              {/* Recording Controls */}
              <div className="flex items-center gap-4">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    <Mic className="w-5 h-5" />
                    Start Recording
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-6 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 animate-pulse"
                  >
                    <Square className="w-5 h-5" />
                    Stop Recording
                  </button>
                )}
                
                {audioBlob && (
                  <button
                    onClick={transcribeAudio}
                    disabled={isTranscribing}
                    className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isTranscribing ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Transcribing...
                      </>
                    ) : (
                      <>
                        <Brain className="w-5 h-5" />
                        Transcribe
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Results */}
              {transcription && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Transcription</span>
                    {asrLatency && (
                      <span className="text-sm text-gray-500">Latency: {asrLatency}ms</span>
                    )}
                  </div>
                  <p className="text-lg text-gray-900">{transcription}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TTS Test Tab */}
        {activeTab === 'tts' && (
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-purple-600" />
              Text-to-Speech Test
            </h3>
            
            <div className="space-y-4">
              {/* Language & Voice Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                  <select
                    value={selectedTtsLanguage}
                    onChange={(e) => {
                      setSelectedTtsLanguage(e.target.value);
                      setSelectedVoice('default');
                    }}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.flag} {lang.name} ({lang.native})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Voice</label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    {(TTS_VOICES[selectedTtsLanguage] || TTS_VOICES['hi']).map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} ({voice.gender})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Text Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Text to Speak</label>
                <textarea
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Enter text to convert to speech..."
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={generateSpeech}
                disabled={isGenerating || !ttsText.trim()}
                className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Speech
                  </>
                )}
              </button>

              {/* Audio Player */}
              {ttsAudioUrl && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Generated Audio</span>
                    {ttsLatency && (
                      <span className="text-sm text-gray-500">Latency: {ttsLatency}ms</span>
                    )}
                  </div>
                  <audio controls src={ttsAudioUrl} className="w-full" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pipeline Test Tab */}
        {activeTab === 'pipeline' && (
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-600" />
              End-to-End Pipeline Test
            </h3>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Test the complete voice pipeline: TTS → ASR → LLM → Response
              </p>

              {/* Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Test Input (Hindi)</label>
                <input
                  type="text"
                  value={pipelineInput}
                  onChange={(e) => setPipelineInput(e.target.value)}
                  placeholder="नमस्ते, मुझे एक ऑर्डर देना है"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              {/* Run Test */}
              <button
                onClick={runPipelineTest}
                disabled={isPipelineRunning}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isPipelineRunning ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Running Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Run Pipeline Test
                  </>
                )}
              </button>

              {/* Results */}
              {pipelineLatencies && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg text-center">
                    <div className="text-sm text-gray-600">TTS</div>
                    <div className="text-xl font-bold text-blue-600">{pipelineLatencies.tts}ms</div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg text-center">
                    <div className="text-sm text-gray-600">ASR</div>
                    <div className="text-xl font-bold text-green-600">{pipelineLatencies.asr}ms</div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg text-center">
                    <div className="text-sm text-gray-600">LLM</div>
                    <div className="text-xl font-bold text-purple-600">{pipelineLatencies.llm}ms</div>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg text-center">
                    <div className="text-sm text-gray-600">Total</div>
                    <div className="text-xl font-bold text-orange-600">{pipelineLatencies.total}ms</div>
                  </div>
                </div>
              )}

              {pipelineResponse && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-700 mb-2">LLM Response</div>
                  <p className="text-lg text-gray-900">{pipelineResponse}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-600" />
              Voice Stack Configuration
            </h3>
            
            <div className="space-y-6">
              {/* Endpoints */}
              <div>
                <h4 className="font-medium text-gray-800 mb-3">Service Endpoints</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">ASR</div>
                    <div>{ASR_URL}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">TTS</div>
                    <div>{TTS_URL}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Orchestrator</div>
                    <div>{ORCHESTRATOR_URL}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">LLM (Jupiter)</div>
                    <div>{LLM_URL}</div>
                  </div>
                </div>
              </div>

              {/* Models Info */}
              <div>
                <h4 className="font-medium text-gray-800 mb-3">Active Models</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded">
                    <span className="font-medium">ASR</span>
                    <span>distil-whisper/distil-large-v3 (faster-whisper)</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded">
                    <span className="font-medium">TTS</span>
                    <span>ai4bharat/indic-parler-tts + Kokoro</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-purple-50 rounded">
                    <span className="font-medium">LLM</span>
                    <span>Qwen/Qwen2.5-7B-Instruct-AWQ</span>
                  </div>
                </div>
              </div>

              {/* Supported Languages */}
              <div>
                <h4 className="font-medium text-gray-800 mb-3">Supported Languages</h4>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((lang) => (
                    <span key={lang.code} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                      {lang.flag} {lang.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
