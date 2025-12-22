'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Mic, Volume2, Settings, RefreshCw, CheckCircle, XCircle, AlertCircle,
  Play, Square, Upload, Download, Globe, Zap, Activity,
  Languages, Clock, Gauge, Server, Sliders, TestTube, FileAudio,
  Brain, Waves, Radio, Speaker, Sparkles, User
} from 'lucide-react';
import Link from 'next/link';

// Mercury voice server URL
const VOICE_SERVER_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL || 'http://192.168.0.151';
const ASR_PORT = 7000;
const TTS_PORT = 8010;

interface VoiceServiceStatus {
  asr: {
    status: 'healthy' | 'unhealthy' | 'offline';
    provider: string;
    model: string;
    device: string;
    latency: number;
    languages: string[];
  };
  tts: {
    status: 'healthy' | 'unhealthy' | 'offline';
    provider: string;
    model: string;
    latency: number;
    voices: string[];
    emotions: string[];
  };
}

interface ASRConfig {
  provider: 'whisper-local' | 'google' | 'azure';
  model: 'large-v3' | 'large-v3-turbo' | 'distil-large-v3';
  language: string;
  enableTimestamps: boolean;
  enableWordConfidence: boolean;
  vadFilter: boolean;
}

interface TTSConfig {
  provider: 'orpheus' | 'xtts' | 'google' | 'azure';
  voice: string;
  emotion: string | null;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
}

// Orpheus TTS voices
const ORPHEUS_VOICES = [
  { id: 'tara', name: 'Tara', gender: 'female', description: 'Natural, warm voice' },
  { id: 'leah', name: 'Leah', gender: 'female', description: 'Professional, clear' },
  { id: 'jess', name: 'Jess', gender: 'female', description: 'Friendly, youthful' },
  { id: 'mia', name: 'Mia', gender: 'female', description: 'Soft, gentle' },
  { id: 'leo', name: 'Leo', gender: 'male', description: 'Deep, authoritative' },
  { id: 'dan', name: 'Dan', gender: 'male', description: 'Casual, friendly' },
  { id: 'zac', name: 'Zac', gender: 'male', description: 'Energetic, young' },
  { id: 'zoe', name: 'Zoe', gender: 'female', description: 'Expressive, dynamic' },
];

// Orpheus emotion tags
const ORPHEUS_EMOTIONS = [
  { id: 'laugh', emoji: '😂', description: 'Laughter' },
  { id: 'chuckle', emoji: '🤭', description: 'Soft chuckle' },
  { id: 'sigh', emoji: '😔', description: 'Sighing' },
  { id: 'gasp', emoji: '😮', description: 'Gasping' },
  { id: 'cough', emoji: '🤧', description: 'Coughing' },
  { id: 'sniffle', emoji: '🤒', description: 'Sniffling' },
  { id: 'groan', emoji: '😩', description: 'Groaning' },
  { id: 'yawn', emoji: '🥱', description: 'Yawning' },
];

// ASR supported languages
const ASR_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', flag: '🌐' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', flag: '🇮🇳' },
];

export default function VoiceAIPage() {
  const [status, setStatus] = useState<VoiceServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'asr' | 'tts' | 'test'>('asr');
  
  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [asrLatency, setAsrLatency] = useState<number | null>(null);
  
  // TTS test state
  const [ttsText, setTtsText] = useState('नमस्ते, मैं मंगवाले का AI असिस्टेंट हूँ। आज मैं आपकी कैसे मदद कर सकता हूँ?');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [ttsLatency, setTtsLatency] = useState<number | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Configuration
  const [asrConfig, setAsrConfig] = useState<ASRConfig>({
    provider: 'whisper-local',
    model: 'large-v3',
    language: 'auto',
    enableTimestamps: true,
    enableWordConfidence: true,
    vadFilter: true,
  });
  
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>({
    provider: 'orpheus',
    voice: 'tara',
    emotion: null,
    temperature: 0.6,
    topP: 0.8,
    repetitionPenalty: 1.3,
  });

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      // Check ASR service
      const asrStart = Date.now();
      let asrStatus: VoiceServiceStatus['asr'] = {
        status: 'offline',
        provider: 'Faster-Whisper',
        model: 'large-v3',
        device: 'unknown',
        latency: 0,
        languages: [],
      };
      
      try {
        const asrRes = await fetch(`${VOICE_SERVER_URL}:${ASR_PORT}/health`, { 
          method: 'GET',
          cache: 'no-store',
        });
        if (asrRes.ok) {
          const asrData = await asrRes.json();
          asrStatus = {
            status: asrData.model_loaded ? 'healthy' : 'unhealthy',
            provider: 'Faster-Whisper',
            model: asrData.model || 'large-v3',
            device: asrData.device || 'cuda',
            latency: Date.now() - asrStart,
            languages: ASR_LANGUAGES.map(l => l.code),
          };
        }
      } catch (e) {
        console.error('ASR health check failed:', e);
      }

      // Check TTS service
      const ttsStart = Date.now();
      let ttsStatus: VoiceServiceStatus['tts'] = {
        status: 'offline',
        provider: 'Orpheus TTS',
        model: 'orpheus-3b',
        latency: 0,
        voices: [],
        emotions: [],
      };
      
      try {
        const ttsRes = await fetch(`${VOICE_SERVER_URL}:${TTS_PORT}/health`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (ttsRes.ok) {
          const ttsData = await ttsRes.json();
          ttsStatus = {
            status: ttsData.model_loaded ? 'healthy' : 'unhealthy',
            provider: 'Orpheus TTS',
            model: 'orpheus-3b-0.1-ft',
            latency: Date.now() - ttsStart,
            voices: ttsData.voices || [],
            emotions: ttsData.emotions || [],
          };
        }
      } catch (e) {
        console.error('TTS health check failed:', e);
      }

      setStatus({ asr: asrStatus, tts: ttsStatus });
    } catch (error) {
      console.error('Failed to load status:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

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
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('language', asrConfig.language);
      
      const response = await fetch('/api/asr/transcribe/upload', {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      setAsrLatency(Date.now() - startTime);
      
      if (result.success && result.text) {
        setTranscription(result.text);
      } else {
        setTranscription('Failed to transcribe audio');
      }
    } catch (error) {
      console.error('Transcription failed:', error);
      setTranscription('Transcription error');
    } finally {
      setIsTranscribing(false);
    }
  };

  const generateSpeech = async () => {
    if (!ttsText.trim()) return;
    
    setIsGenerating(true);
    const startTime = Date.now();
    
    try {
      // Add emotion tag if selected
      let textToSpeak = ttsText;
      if (ttsConfig.emotion) {
        textToSpeak = `<${ttsConfig.emotion}>${ttsText}`;
      }
      
      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          voice: ttsConfig.voice,
          language: 'hi-IN',
        }),
      });
      
      const result = await response.json();
      setTtsLatency(Date.now() - startTime);
      
      if (result.success && result.audio) {
        // Convert base64 to audio URL
        const audioData = atob(result.audio);
        const arrayBuffer = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          arrayBuffer[i] = audioData.charCodeAt(i);
        }
        const blob = new Blob([arrayBuffer], { type: result.contentType || 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        if (ttsAudioUrl) URL.revokeObjectURL(ttsAudioUrl);
        setTtsAudioUrl(url);
      }
    } catch (error) {
      console.error('TTS failed:', error);
      alert('Failed to generate speech');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveConfig = async () => {
    try {
      // Save configuration to backend
      const response = await fetch('/api/admin/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asr: asrConfig, tts: ttsConfig }),
      });
      
      if (response.ok) {
        alert('Configuration saved successfully!');
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration');
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      healthy: 'bg-green-100 text-green-800 border-green-200',
      unhealthy: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      offline: 'bg-red-100 text-red-800 border-red-200',
    };
    const icons = {
      healthy: <CheckCircle className="w-4 h-4" />,
      unhealthy: <AlertCircle className="w-4 h-4" />,
      offline: <XCircle className="w-4 h-4" />,
    };
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${colors[status as keyof typeof colors]}`}>
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 rounded-lg">
              <Radio className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Voice AI Services</h1>
              <p className="text-emerald-100">Configure Speech-to-Text (ASR) and Text-to-Speech (TTS) for voice interactions</p>
            </div>
          </div>
          <button
            onClick={() => { setRefreshing(true); loadStatus(); }}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Service Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ASR Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Mic className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Speech-to-Text (ASR)</h3>
                <p className="text-sm text-gray-500">Faster-Whisper Large v3</p>
              </div>
            </div>
            <StatusBadge status={status?.asr.status || 'offline'} />
          </div>
          
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Provider</p>
              <p className="font-medium">Whisper (Local)</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Latency</p>
              <p className="font-medium">{status?.asr.latency || 0}ms</p>
            </div>
          </div>
          
          <div className="mt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Supported Languages</p>
            <div className="flex flex-wrap gap-1">
              {['🇬🇧 English', '🇮🇳 Hindi', '🇮🇳 Marathi', '🌐 Auto'].map(lang => (
                <span key={lang} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                  {lang}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* TTS Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Volume2 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Text-to-Speech (TTS)</h3>
                <p className="text-sm text-gray-500">Orpheus TTS 3B</p>
              </div>
            </div>
            <StatusBadge status={status?.tts.status || 'offline'} />
          </div>
          
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Provider</p>
              <p className="font-medium">Orpheus (Local GPU)</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Latency</p>
              <p className="font-medium">{status?.tts.latency || 0}ms</p>
            </div>
          </div>
          
          <div className="mt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Available Voices</p>
            <div className="flex flex-wrap gap-1">
              {(status?.tts.voices || ORPHEUS_VOICES.map(v => v.id)).slice(0, 8).map(voice => (
                <span key={voice} className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs capitalize">
                  {voice}
                </span>
              ))}
            </div>
          </div>
          
          <div className="mt-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Emotion Tags</p>
            <div className="flex flex-wrap gap-1">
              {ORPHEUS_EMOTIONS.map(e => (
                <span key={e.id} className="px-2 py-1 bg-pink-50 text-pink-700 rounded text-xs">
                  {e.emoji} {e.id}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Tabs */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="border-b px-4">
          <nav className="flex gap-6">
            {[
              { id: 'asr', label: 'ASR Settings', icon: Settings },
              { id: 'tts', label: 'TTS Settings', icon: Sliders },
              { id: 'test', label: 'Live Testing', icon: TestTube },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 py-4 px-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-600 text-emerald-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* ASR Settings Tab */}
          {activeTab === 'asr' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ASR Provider</label>
                  <select
                    value={asrConfig.provider}
                    onChange={(e) => setAsrConfig({ ...asrConfig, provider: e.target.value as ASRConfig['provider'] })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="whisper-local">🖥️ Whisper (Local GPU)</option>
                    <option value="google" disabled>☁️ Google Speech (Coming Soon)</option>
                    <option value="azure" disabled>☁️ Azure Speech (Coming Soon)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Local Whisper is free and privacy-preserving</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Model Size</label>
                  <select
                    value={asrConfig.model}
                    onChange={(e) => setAsrConfig({ ...asrConfig, model: e.target.value as ASRConfig['model'] })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="large-v3">Large v3 (2.9GB) - Most Accurate</option>
                    <option value="large-v3-turbo">Large v3 Turbo - Fast</option>
                    <option value="distil-large-v3">Distil Large v3 - Balanced</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default Language</label>
                  <select
                    value={asrConfig.language}
                    onChange={(e) => setAsrConfig({ ...asrConfig, language: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    {ASR_LANGUAGES.map(lang => (
                      <option key={lang.code} value={lang.code}>
                        {lang.flag} {lang.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Features</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={asrConfig.enableTimestamps}
                        onChange={(e) => setAsrConfig({ ...asrConfig, enableTimestamps: e.target.checked })}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm">Word-level Timestamps</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={asrConfig.enableWordConfidence}
                        onChange={(e) => setAsrConfig({ ...asrConfig, enableWordConfidence: e.target.checked })}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm">Confidence Scores</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={asrConfig.vadFilter}
                        onChange={(e) => setAsrConfig({ ...asrConfig, vadFilter: e.target.checked })}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm">Voice Activity Detection (VAD)</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TTS Settings Tab */}
          {activeTab === 'tts' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">TTS Provider</label>
                  <select
                    value={ttsConfig.provider}
                    onChange={(e) => setTtsConfig({ ...ttsConfig, provider: e.target.value as TTSConfig['provider'] })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="orpheus">🎤 Orpheus TTS (Local GPU)</option>
                    <option value="xtts" disabled>🎤 XTTS v2 (Disabled)</option>
                    <option value="google" disabled>☁️ Google TTS (Coming Soon)</option>
                    <option value="azure" disabled>☁️ Azure TTS (Coming Soon)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Orpheus provides natural, emotional speech synthesis</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Voice</label>
                  <select
                    value={ttsConfig.voice}
                    onChange={(e) => setTtsConfig({ ...ttsConfig, voice: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    {ORPHEUS_VOICES.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.gender === 'female' ? '👩' : '👨'} {voice.name} - {voice.description}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Emotion (Optional)</label>
                  <select
                    value={ttsConfig.emotion || ''}
                    onChange={(e) => setTtsConfig({ ...ttsConfig, emotion: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">None (Neutral)</option>
                    {ORPHEUS_EMOTIONS.map(emotion => (
                      <option key={emotion.id} value={emotion.id}>
                        {emotion.emoji} {emotion.id} - {emotion.description}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Add emotional expressiveness to speech</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Temperature: {ttsConfig.temperature}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.5"
                    step="0.1"
                    value={ttsConfig.temperature}
                    onChange={(e) => setTtsConfig({ ...ttsConfig, temperature: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Conservative</span>
                    <span>Creative</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <h4 className="font-medium text-purple-900 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Orpheus Emotion Tags
                </h4>
                <p className="text-sm text-purple-700 mb-3">
                  Add emotion tags to your text to make speech more expressive. Example: <code className="bg-purple-100 px-1 rounded">&lt;laugh&gt;That&apos;s hilarious!</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  {ORPHEUS_EMOTIONS.map(e => (
                    <span key={e.id} className="px-3 py-1.5 bg-white border border-purple-200 rounded-full text-sm">
                      {e.emoji} &lt;{e.id}&gt;
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Live Testing Tab */}
          {activeTab === 'test' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* ASR Test */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Mic className="w-5 h-5 text-blue-600" />
                  Test Speech-to-Text
                </h3>
                
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                        isRecording
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isRecording ? (
                        <>
                          <Square className="w-4 h-4" />
                          Stop Recording
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4" />
                          Start Recording
                        </>
                      )}
                    </button>
                    
                    {audioBlob && (
                      <button
                        onClick={transcribeAudio}
                        disabled={isTranscribing}
                        className="flex items-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isTranscribing ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                        Transcribe
                      </button>
                    )}
                  </div>
                  
                  {transcription && (
                    <div className="p-3 bg-white border rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Transcription {asrLatency && `(${asrLatency}ms)`}:</p>
                      <p className="text-gray-900">{transcription}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* TTS Test */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-purple-600" />
                  Test Text-to-Speech
                </h3>
                
                <div className="space-y-4">
                  <textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    placeholder="Enter text to speak..."
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                  
                  <div className="flex gap-2">
                    <select
                      value={ttsConfig.voice}
                      onChange={(e) => setTtsConfig({ ...ttsConfig, voice: e.target.value })}
                      className="px-3 py-2 border rounded-lg text-sm"
                    >
                      {ORPHEUS_VOICES.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    
                    <button
                      onClick={generateSpeech}
                      disabled={isGenerating || !ttsText.trim()}
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Generate Speech
                    </button>
                  </div>
                  
                  {ttsAudioUrl && (
                    <div className="p-3 bg-white border rounded-lg">
                      <p className="text-sm text-gray-500 mb-2">Generated Audio {ttsLatency && `(${ttsLatency}ms)`}:</p>
                      <audio controls src={ttsAudioUrl} className="w-full" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-between items-center">
          <Link
            href="/admin/voice/orpheus"
            className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Open Orpheus TTS Studio →
          </Link>
          
          <div className="flex gap-3">
            <button
              onClick={() => { setAsrConfig({ provider: 'whisper-local', model: 'large-v3', language: 'auto', enableTimestamps: true, enableWordConfidence: true, vadFilter: true }); setTtsConfig({ provider: 'orpheus', voice: 'tara', emotion: null, temperature: 0.6, topP: 0.8, repetitionPenalty: 1.3 }); }}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              Reset to Defaults
            </button>
            <button
              onClick={saveConfig}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
