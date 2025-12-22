'use client';

import { useState, useEffect } from 'react';
import {
  Phone, PhoneCall, PhoneForwarded, Shield, MessageSquare,
  Users, BarChart3, Settings, RefreshCw, CheckCircle, XCircle,
  AlertCircle, Play, Square, Mic, Volume2, Activity, Zap,
  Clock, Globe, Hash, List, Send, Radio, Headphones
} from 'lucide-react';

interface ExotelStatus {
  status: string;
  service: string;
  version: string;
  features: string[];
  connections: {
    jupiter: { url: string; connected: boolean };
    php: { url: string; connected: boolean; latency: number };
  };
}

export default function ExotelPage() {
  const [status, setStatus] = useState<ExotelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'calls' | 'campaigns' | 'settings'>('overview');
  
  // Click-to-Call state
  const [agentPhone, setAgentPhone] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [calling, setCalling] = useState(false);
  
  // Number Masking state
  const [partyA, setPartyA] = useState('');
  const [partyB, setPartyB] = useState('');
  const [creatingMask, setCreatingMask] = useState(false);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const response = await fetch('/api/exotel/health');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to load Exotel status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClickToCall = async () => {
    if (agentPhone === '' || customerPhone === '') return;
    setCalling(true);
    try {
      const response = await fetch('/api/exotel/click-to-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentPhone, customerPhone }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Call initiated successfully! Agent will receive call first.');
      } else {
        alert('Failed to initiate call: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error initiating call');
    } finally {
      setCalling(false);
    }
  };

  const handleCreateMask = async () => {
    if (partyA === '' || partyB === '') return;
    setCreatingMask(true);
    try {
      const response = await fetch('/api/exotel/number-masking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyA, partyB, expiresInHours: 24 }),
      });
      const data = await response.json();
      if (data.success) {
        alert(`Virtual number created: ${data.virtualNumber}\nValid for 24 hours`);
      } else {
        alert('Failed to create masked number');
      }
    } catch (error) {
      alert('Error creating masked number');
    } finally {
      setCreatingMask(false);
    }
  };

  const getStatusBadge = (connected: boolean) => (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
      connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {connected ? <CheckCircle size={14} /> : <XCircle size={14} />}
      {connected ? 'Connected' : 'Offline'}
    </span>
  );

  const getFeatureIcon = (feature: string) => {
    const icons: Record<string, any> = {
      'ivr': Phone,
      'comms': MessageSquare,
      'campaigns': Users,
      'voice-ordering': Mic,
      'jupiter-integration': Globe,
      'number-masking': Shield,
      'click-to-call': PhoneCall,
      'voice-streaming': Radio,
      'verified-calls': CheckCircle,
      'sms-whatsapp': Send,
      'auto-dialer': PhoneForwarded,
      'cqa': BarChart3,
      'call-recording': Headphones,
    };
    const Icon = icons[feature] || Zap;
    return <Icon size={16} />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-[#059211]" size={48} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-8 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Phone size={32} />
              <h1 className="text-3xl font-bold">Exotel Cloud Telephony</h1>
            </div>
            <p className="text-orange-100">
              IVR, Click-to-Call, Number Masking, Voice Streaming & More
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-orange-100">Service Version</div>
            <div className="text-2xl font-bold">{status?.version || 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Service Status */}
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-100 rounded-lg">
                <Activity size={24} className="text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Service Status</h3>
                <p className="text-sm text-gray-500">Mercury (192.168.0.151:3100)</p>
              </div>
            </div>
            {status && getStatusBadge(status.status === 'ok')}
          </div>
        </div>

        {/* Jupiter Connection */}
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Globe size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Jupiter API</h3>
                <p className="text-sm text-gray-500">{status?.connections?.jupiter?.url || 'N/A'}</p>
              </div>
            </div>
            {status && getStatusBadge(status.connections?.jupiter?.connected || false)}
          </div>
        </div>

        {/* PHP Backend */}
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Hash size={24} className="text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">PHP Backend</h3>
                <p className="text-sm text-gray-500">
                  {status?.connections?.php?.latency ? `${status.connections.php.latency}ms` : 'N/A'}
                </p>
              </div>
            </div>
            {status && getStatusBadge(status.connections?.php?.connected || false)}
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-100 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Enabled Features</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {(status?.features || []).map((feature) => (
            <div
              key={feature}
              className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg"
            >
              {getFeatureIcon(feature)}
              <span className="text-sm font-medium text-green-800 capitalize">
                {feature.replace(/-/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-100">
        <div className="border-b border-gray-200">
          <div className="flex gap-0">
            {[
              { id: 'overview', label: 'Quick Actions', icon: <Zap size={18} /> },
              { id: 'calls', label: 'Call Logs', icon: <List size={18} /> },
              { id: 'campaigns', label: 'Campaigns', icon: <Users size={18} /> },
              { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-6 py-4 font-medium transition-all ${
                  activeTab === tab.id
                    ? 'text-orange-600 border-b-2 border-orange-500 bg-orange-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Quick Actions Tab */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Click-to-Call */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border-2 border-blue-200">
                <div className="flex items-center gap-3 mb-4">
                  <PhoneCall size={24} className="text-blue-600" />
                  <h3 className="text-lg font-bold text-gray-900">Click-to-Call</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Connect agent to customer. Agent receives call first, then customer is connected.
                </p>
                <div className="space-y-3">
                  <input
                    type="tel"
                    placeholder="Agent Phone (+91...)"
                    value={agentPhone}
                    onChange={(e) => setAgentPhone(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="tel"
                    placeholder="Customer Phone (+91...)"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-blue-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={handleClickToCall}
                    disabled={calling || agentPhone === '' || customerPhone === ''}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {calling ? <RefreshCw size={20} className="animate-spin" /> : <PhoneCall size={20} />}
                    {calling ? 'Connecting...' : 'Initiate Call'}
                  </button>
                </div>
              </div>

              {/* Number Masking */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border-2 border-purple-200">
                <div className="flex items-center gap-3 mb-4">
                  <Shield size={24} className="text-purple-600" />
                  <h3 className="text-lg font-bold text-gray-900">Number Masking</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Create a virtual number to protect privacy. Both parties see the virtual number.
                </p>
                <div className="space-y-3">
                  <input
                    type="tel"
                    placeholder="Party A Phone (Agent)"
                    value={partyA}
                    onChange={(e) => setPartyA(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-purple-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                  <input
                    type="tel"
                    placeholder="Party B Phone (Customer)"
                    value={partyB}
                    onChange={(e) => setPartyB(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-purple-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={handleCreateMask}
                    disabled={creatingMask || partyA === '' || partyB === ''}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
                  >
                    {creatingMask ? <RefreshCw size={20} className="animate-spin" /> : <Shield size={20} />}
                    {creatingMask ? 'Creating...' : 'Create Virtual Number'}
                  </button>
                </div>
              </div>

              {/* Verified Calls */}
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle size={24} className="text-green-600" />
                  <h3 className="text-lg font-bold text-gray-900">Verified Calls (Truecaller)</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Calls show branded caller ID with business name and call reason.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Order Update', 'Delivery', 'Payment', 'Support'].map((reason) => (
                    <span
                      key={reason}
                      className="px-3 py-1 bg-green-200 text-green-800 rounded-full text-sm font-medium"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>

              {/* Voice Streaming */}
              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border-2 border-red-200">
                <div className="flex items-center gap-3 mb-4">
                  <Radio size={24} className="text-red-600" />
                  <h3 className="text-lg font-bold text-gray-900">Voice Streaming</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Real-time voice streaming with AgentStream for live transcription and AI assistance.
                </p>
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <Activity size={16} />
                  <span>WebSocket: ws://192.168.0.151:3100/voice-stream/ws</span>
                </div>
              </div>
            </div>
          )}

          {/* Call Logs Tab */}
          {activeTab === 'calls' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Recent Calls</h3>
                <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                  <RefreshCw size={16} />
                  Refresh
                </button>
              </div>
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <Phone size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">Call logs will appear here</p>
                <p className="text-sm text-gray-500 mt-2">Connect to Exotel to view call history</p>
              </div>
            </div>
          )}

          {/* Campaigns Tab */}
          {activeTab === 'campaigns' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Auto Dialer Campaigns</h3>
                <button className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                  <Zap size={16} />
                  New Campaign
                </button>
              </div>
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <Users size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">No active campaigns</p>
                <p className="text-sm text-gray-500 mt-2">Create an outbound calling campaign</p>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Exotel Service URL
                  </label>
                  <input
                    type="text"
                    value="http://192.168.0.151:3100"
                    disabled
                    className="w-full px-4 py-2 bg-gray-100 border-2 border-gray-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Default Caller ID
                  </label>
                  <input
                    type="text"
                    placeholder="Virtual Number from Exotel"
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="pt-4">
                <button className="px-6 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700">
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
