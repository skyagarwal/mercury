'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Mic, Volume2, Settings, RefreshCw, CheckCircle, XCircle, AlertCircle,
  Play, Square, Upload, Download, Trash2, Plus, Copy, Pause,
  Languages, Clock, Gauge, Server, Sliders, FileAudio, Save,
  Waves, Radio, Speaker, User, Music, Sparkles, Heart
} from 'lucide-react';

// Mercury voice server URL
const TTS_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL 
  ? `${process.env.NEXT_PUBLIC_VOICE_SERVER_URL}:8010`
  : 'http://192.168.0.151:8010';

interface OrpheusHealth {
  status: 'healthy' | 'unhealthy' | 'offline';
  model_loaded: boolean;
  voices: string[];
  emotions: string[];
}

interface GeneratedAudio {
  id: string;
  text: string;
  voice: string;
  emotion: string | null;
  audioUrl: string;
  duration: number;
  generationTime: number;
  createdAt: Date;
}

// Orpheus TTS voices with detailed info
const ORPHEUS_VOICES = [
  { id: 'tara', name: 'Tara', gender: 'female', accent: 'American', description: 'Warm, natural, versatile voice. Great for conversational AI.', color: 'rose' },
  { id: 'leah', name: 'Leah', gender: 'female', accent: 'American', description: 'Professional, clear enunciation. Ideal for business content.', color: 'violet' },
  { id: 'jess', name: 'Jess', gender: 'female', accent: 'American', description: 'Friendly, youthful energy. Perfect for casual interactions.', color: 'amber' },
  { id: 'mia', name: 'Mia', gender: 'female', accent: 'American', description: 'Soft, gentle, calming. Great for meditation or support.', color: 'cyan' },
  { id: 'leo', name: 'Leo', gender: 'male', accent: 'American', description: 'Deep, authoritative voice. Good for announcements.', color: 'blue' },
  { id: 'dan', name: 'Dan', gender: 'male', accent: 'American', description: 'Casual, approachable, friendly male voice.', color: 'emerald' },
  { id: 'zac', name: 'Zac', gender: 'male', accent: 'American', description: 'Energetic, young, enthusiastic delivery.', color: 'orange' },
  { id: 'zoe', name: 'Zoe', gender: 'female', accent: 'American', description: 'Expressive, dynamic range. Great for storytelling.', color: 'pink' },
];

// Orpheus emotion tags
const ORPHEUS_EMOTIONS = [
  { id: 'laugh', emoji: '😂', name: 'Laugh', description: 'Full laughter', example: '<laugh>That\'s so funny!' },
  { id: 'chuckle', emoji: '🤭', name: 'Chuckle', description: 'Soft amusement', example: '<chuckle>Oh, I see what you did there.' },
  { id: 'sigh', emoji: '😔', name: 'Sigh', description: 'Tired or resigned', example: '<sigh>Well, that didn\'t work.' },
  { id: 'gasp', emoji: '😮', name: 'Gasp', description: 'Surprise or shock', example: '<gasp>I can\'t believe it!' },
  { id: 'cough', emoji: '🤧', name: 'Cough', description: 'Clearing throat', example: '<cough>Excuse me, as I was saying...' },
  { id: 'sniffle', emoji: '🤒', name: 'Sniffle', description: 'Emotional or cold', example: '<sniffle>That\'s so touching.' },
  { id: 'groan', emoji: '😩', name: 'Groan', description: 'Frustration', example: '<groan>Not again!' },
  { id: 'yawn', emoji: '🥱', name: 'Yawn', description: 'Tiredness', example: '<yawn>It\'s getting late.' },
];

// Sample texts in different languages
const SAMPLE_TEXTS: Record<string, { text: string; language: string; flag: string }> = {
  en: { text: "Hello! I'm your AI assistant from Mangwale. How can I help you today?", language: 'English', flag: '🇬🇧' },
  hi: { text: "नमस्ते! मैं मंगवाले का AI असिस्टेंट हूँ। आज मैं आपकी कैसे मदद कर सकता हूँ?", language: 'Hindi', flag: '🇮🇳' },
  hinglish: { text: "Hello! Main Mangwale ka AI assistant hoon. Aaj main aapki kaise help kar sakta hoon?", language: 'Hinglish', flag: '🇮🇳' },
  mr: { text: "नमस्कार! मी मंगवाले चा AI असिस्टंट आहे. आज मी तुम्हाला कशी मदत करू शकतो?", language: 'Marathi', flag: '🇮🇳' },
};

export default function OrpheusStudioPage() {
  const [health, setHealth] = useState<OrpheusHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'synthesize' | 'voices' | 'emotions' | 'history'>('synthesize');
  
  // TTS state
  const [text, setText] = useState(SAMPLE_TEXTS.hi.text);
  const [selectedVoice, setSelectedVoice] = useState('tara');
  const [selectedEmotion, setSelectedEmotion] = useState<string | null>(null);
  const [temperature, setTemperature] = useState(0.6);
  const [topP, setTopP] = useState(0.8);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.3);
  
  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<GeneratedAudio | null>(null);
  const [history, setHistory] = useState<GeneratedAudio[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkHealth = async () => {
    try {
      const response = await fetch(`${TTS_URL}/health`);
      if (response.ok) {
        const data = await response.json();
        setHealth({
          status: data.model_loaded ? 'healthy' : 'unhealthy',
          model_loaded: data.model_loaded,
          voices: data.voices || [],
          emotions: data.emotions || [],
        });
      } else {
        setHealth({ status: 'offline', model_loaded: false, voices: [], emotions: [] });
      }
    } catch {
      setHealth({ status: 'offline', model_loaded: false, voices: [], emotions: [] });
    } finally {
      setLoading(false);
    }
  };

  const generateSpeech = async () => {
    if (!text.trim()) return;
    
    setIsGenerating(true);
    const startTime = Date.now();
    
    try {
      // Build text with emotion tag if selected
      let textToSpeak = text;
      if (selectedEmotion) {
        textToSpeak = `<${selectedEmotion}>${text}`;
      }
      
      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          voice: selectedVoice,
          temperature,
          top_p: topP,
          repetition_penalty: repetitionPenalty,
        }),
      });
      
      const result = await response.json();
      const generationTime = Date.now() - startTime;
      
      if (result.success && result.audio) {
        // Convert base64 to audio URL
        const audioData = atob(result.audio);
        const arrayBuffer = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          arrayBuffer[i] = audioData.charCodeAt(i);
        }
        const blob = new Blob([arrayBuffer], { type: result.contentType || 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        
        // Calculate approximate duration (WAV at 24kHz, 16-bit mono)
        const duration = blob.size / (24000 * 2);
        
        const newAudio: GeneratedAudio = {
          id: Date.now().toString(),
          text: text.substring(0, 100),
          voice: selectedVoice,
          emotion: selectedEmotion,
          audioUrl,
          duration,
          generationTime,
          createdAt: new Date(),
        };
        
        setGeneratedAudio(newAudio);
        setHistory(prev => [newAudio, ...prev].slice(0, 20)); // Keep last 20
        
        // Auto-play
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.play();
          setIsPlaying(true);
        }
      } else {
        throw new Error(result.error || 'Failed to generate speech');
      }
    } catch (error) {
      console.error('TTS generation failed:', error);
      alert('Failed to generate speech. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const playAudio = (audioUrl: string) => {
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  const downloadAudio = (audioUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${filename}.wav`;
    a.click();
  };

  const insertEmotionTag = (emotion: string) => {
    const tag = `<${emotion}>`;
    setText(prev => tag + prev);
    setSelectedEmotion(emotion);
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      healthy: 'bg-green-500',
      unhealthy: 'bg-yellow-500',
      offline: 'bg-red-500',
    };
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-sm font-medium ${colors[status as keyof typeof colors]}`}>
        <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hidden audio element */}
      <audio 
        ref={audioRef} 
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl">
              <Sparkles className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">Orpheus TTS Studio</h1>
                <span className="px-2 py-0.5 bg-white/20 rounded text-xs">3B</span>
              </div>
              <p className="text-purple-100">Neural Text-to-Speech with Emotion Control • Powered by CanopyAI</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge status={health?.status || 'offline'} />
            <button
              onClick={checkHealth}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-purple-200 text-sm">Model</p>
            <p className="font-semibold">Orpheus 3B</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-purple-200 text-sm">GPU</p>
            <p className="font-semibold">✓ CUDA</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-purple-200 text-sm">Latency</p>
            <p className="font-semibold">~200ms</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-purple-200 text-sm">Voices</p>
            <p className="font-semibold">{health?.voices.length || 8}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="border-b px-4">
          <nav className="flex gap-6">
            {[
              { id: 'synthesize', label: 'Text to Speech', icon: Volume2 },
              { id: 'voices', label: 'Voice Library', icon: User },
              { id: 'emotions', label: 'Emotions', icon: Heart },
              { id: 'history', label: 'History', icon: Clock },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 py-4 px-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-purple-600 text-purple-600'
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
          {/* Text to Speech Tab */}
          {activeTab === 'synthesize' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main input area */}
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Text to Speak</label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Enter text to convert to speech..."
                    rows={6}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                  <div className="flex justify-between mt-2 text-sm text-gray-500">
                    <span>{text.length} characters</span>
                    <span>~{Math.ceil(text.length / 15)} seconds</span>
                  </div>
                </div>

                {/* Quick samples */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Quick Samples</label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(SAMPLE_TEXTS).map(([key, sample]) => (
                      <button
                        key={key}
                        onClick={() => setText(sample.text)}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-sm transition-colors"
                      >
                        {sample.flag} {sample.language}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Emotion Tags */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Add Emotion Tag</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedEmotion(null)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                        !selectedEmotion 
                          ? 'bg-purple-600 text-white' 
                          : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      😐 Neutral
                    </button>
                    {ORPHEUS_EMOTIONS.map(emotion => (
                      <button
                        key={emotion.id}
                        onClick={() => insertEmotionTag(emotion.id)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                          selectedEmotion === emotion.id 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                        title={emotion.example}
                      >
                        {emotion.emoji} {emotion.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={generateSpeech}
                  disabled={isGenerating || !text.trim() || health?.status !== 'healthy'}
                  className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
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

                {/* Generated Audio Player */}
                {generatedAudio && (
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-100">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center">
                          <Volume2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Generated Audio</p>
                          <p className="text-sm text-gray-500">
                            {ORPHEUS_VOICES.find(v => v.id === generatedAudio.voice)?.name} • 
                            {generatedAudio.duration.toFixed(1)}s • 
                            {generatedAudio.generationTime}ms
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => isPlaying ? stopAudio() : playAudio(generatedAudio.audioUrl)}
                          className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                        >
                          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        </button>
                        <button
                          onClick={() => downloadAudio(generatedAudio.audioUrl, `orpheus-${generatedAudio.voice}`)}
                          className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <audio controls src={generatedAudio.audioUrl} className="w-full" />
                  </div>
                )}
              </div>

              {/* Settings Sidebar */}
              <div className="space-y-4">
                {/* Voice Selection */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-3">🎤 Voice</label>
                  <div className="space-y-2">
                    {ORPHEUS_VOICES.map(voice => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`w-full p-3 rounded-lg text-left transition-all ${
                          selectedVoice === voice.id
                            ? 'bg-purple-600 text-white shadow-lg'
                            : 'bg-white hover:bg-gray-100 border'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{voice.gender === 'female' ? '👩' : '👨'}</span>
                          <div>
                            <p className="font-medium">{voice.name}</p>
                            <p className={`text-xs ${selectedVoice === voice.id ? 'text-purple-200' : 'text-gray-500'}`}>
                              {voice.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Advanced Settings */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-3">⚙️ Settings</label>
                  
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Temperature</span>
                        <span className="font-medium">{temperature}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.5"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        className="w-full accent-purple-600"
                      />
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Consistent</span>
                        <span>Creative</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Top P</span>
                        <span className="font-medium">{topP}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={topP}
                        onChange={(e) => setTopP(parseFloat(e.target.value))}
                        className="w-full accent-purple-600"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Repetition Penalty</span>
                        <span className="font-medium">{repetitionPenalty}</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="2.0"
                        step="0.1"
                        value={repetitionPenalty}
                        onChange={(e) => setRepetitionPenalty(parseFloat(e.target.value))}
                        className="w-full accent-purple-600"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Voice Library Tab */}
          {activeTab === 'voices' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {ORPHEUS_VOICES.map(voice => (
                <div
                  key={voice.id}
                  className={`bg-gradient-to-br from-${voice.color}-50 to-${voice.color}-100 rounded-xl p-4 border border-${voice.color}-200 hover:shadow-lg transition-all cursor-pointer`}
                  onClick={() => { setSelectedVoice(voice.id); setActiveTab('synthesize'); }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-12 h-12 bg-${voice.color}-500 rounded-full flex items-center justify-center text-white text-xl`}>
                      {voice.gender === 'female' ? '👩' : '👨'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{voice.name}</h3>
                      <p className="text-sm text-gray-500">{voice.accent} • {voice.gender}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">{voice.description}</p>
                  <button
                    className={`mt-3 w-full py-2 bg-${voice.color}-600 text-white rounded-lg text-sm font-medium hover:bg-${voice.color}-700 transition-colors`}
                    onClick={(e) => { e.stopPropagation(); setSelectedVoice(voice.id); setActiveTab('synthesize'); }}
                  >
                    Try Voice
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Emotions Tab */}
          {activeTab === 'emotions' && (
            <div className="space-y-6">
              <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                <h3 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  How to Use Emotion Tags
                </h3>
                <p className="text-purple-700">
                  Orpheus TTS supports inline emotion tags that add expressiveness to speech. 
                  Add tags at the beginning of your text or before specific phrases.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {ORPHEUS_EMOTIONS.map(emotion => (
                  <div
                    key={emotion.id}
                    className="bg-white rounded-xl p-4 border hover:shadow-lg transition-all"
                  >
                    <div className="text-4xl mb-3">{emotion.emoji}</div>
                    <h3 className="font-semibold text-gray-900">{emotion.name}</h3>
                    <p className="text-sm text-gray-500 mb-2">{emotion.description}</p>
                    <code className="block text-xs bg-gray-100 p-2 rounded text-gray-700 mb-3">
                      {emotion.example}
                    </code>
                    <button
                      onClick={() => { setText(emotion.example); setSelectedEmotion(emotion.id); setActiveTab('synthesize'); }}
                      className="w-full py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 transition-colors"
                    >
                      Try Example
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {history.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileAudio className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No generated audio yet</p>
                  <p className="text-sm">Generate some speech to see it here</p>
                </div>
              ) : (
                history.map(item => (
                  <div
                    key={item.id}
                    className="bg-gray-50 rounded-xl p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => playAudio(item.audioUrl)}
                        className="w-10 h-10 bg-purple-600 text-white rounded-full flex items-center justify-center hover:bg-purple-700"
                      >
                        <Play className="w-5 h-5" />
                      </button>
                      <div>
                        <p className="font-medium text-gray-900 line-clamp-1">{item.text}</p>
                        <p className="text-sm text-gray-500">
                          {ORPHEUS_VOICES.find(v => v.id === item.voice)?.name} • 
                          {item.emotion ? ` ${item.emotion} • ` : ' '}
                          {item.duration.toFixed(1)}s • 
                          {new Date(item.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadAudio(item.audioUrl, `orpheus-${item.voice}-${item.id}`)}
                        className="p-2 text-gray-500 hover:text-gray-700"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => navigator.clipboard.writeText(item.text)}
                        className="p-2 text-gray-500 hover:text-gray-700"
                      >
                        <Copy className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
