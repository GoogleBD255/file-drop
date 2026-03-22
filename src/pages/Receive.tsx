import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PeerConnection } from '../webrtc/peer';
import { FileReceiver } from '../webrtc/fileReceiver';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { Download, AlertCircle, Camera, Image as ImageIcon, Upload, Link as LinkIcon } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'react-hot-toast';

export function Receive() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'scanning' | 'connecting' | 'connected' | 'error'>('connecting');
  const [scanMethod, setScanMethod] = useState<'camera' | 'file'>('camera');
  const [manualLink, setManualLink] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const peerRef = useRef<PeerConnection | null>(null);
  const receiversRef = useRef<Map<number, FileReceiver>>(new Map());

  useEffect(() => {
    if (!roomId) {
      setStatus('scanning');
      return;
    }

    setStatus('connecting');
    const peer = new PeerConnection(roomId, false);
    peerRef.current = peer;

    peer.onConnectionStateChange = (state) => {
      if (state === 'connected') {
        setPeerConnected(true);
        setStatus('connected');
        toast.success('Connected to sender!');
      } else if (state === 'disconnected' || state === 'failed') {
        setPeerConnected(false);
        setStatus('error');
        toast.error('Connection to sender lost.');
      }
    };

    peer.onDataChannel = (channel) => {
      channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          if (data.type === 'metadata') {
            const receiver = new FileReceiver(data);
            
            receiver.onProgress = (p, s) => {
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, progress: p, speed: s } : f));
            };
            
            receiver.onComplete = (file) => {
              const url = URL.createObjectURL(file);
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'completed', progress: 100, speed: 0, url } : f));
              receiversRef.current.delete(data.fileId);
              
              toast.success(`File received: ${file.name}`);
              
              // Auto download
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };

            receiversRef.current.set(data.fileId, receiver);
            
            setFiles(prev => [...prev, {
              id: data.fileId,
              name: data.name,
              size: data.size,
              type: data.fileType,
              progress: 0,
              speed: 0,
              status: 'transferring'
            }]);
          } else if (data.type === 'complete') {
            receiversRef.current.get(data.fileId)?.finish();
          } else if (data.type === 'cancel') {
            receiversRef.current.delete(data.fileId);
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'cancelled' } : f));
          } else if (data.type === 'pause') {
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'paused', speed: 0 } : f));
          } else if (data.type === 'resume') {
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'transferring' } : f));
          }
        } else if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data);
          const fileId = view.getUint32(0);
          const chunk = event.data.slice(4);
          receiversRef.current.get(fileId)?.receiveChunk(chunk);
        }
      };
    };

    return () => {
      peer.close();
      // Cleanup URLs
      setFiles(prev => {
        prev.forEach(f => {
          if (f.url) URL.revokeObjectURL(f.url);
        });
        return prev;
      });
    };
  }, [roomId]);

  const handleScanSuccess = (text: string) => {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (id) {
        toast.success('QR Code scanned successfully!');
        navigate(`/receive/${id}`);
      } else {
        toast.error('Invalid QR code format.');
      }
    } catch (e) {
      console.error("Invalid QR code URL");
      toast.error('Invalid QR code URL. Please try again.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const loadingToast = toast.loading('Scanning image...');
    try {
      const html5QrCode = new Html5Qrcode("reader-hidden");
      const decodedText = await html5QrCode.scanFile(file, true);
      toast.dismiss(loadingToast);
      handleScanSuccess(decodedText);
    } catch (err) {
      console.error("Error scanning file", err);
      toast.dismiss(loadingToast);
      toast.error("Could not find a valid QR code in the image.");
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualLink.trim()) return;
    
    try {
      let id = manualLink.trim();
      if (manualLink.includes('/')) {
        const url = new URL(manualLink.startsWith('http') ? manualLink : `https://${manualLink}`);
        const parts = url.pathname.split('/');
        id = parts[parts.length - 1];
      }
      
      if (id) {
        navigate(`/receive/${id}`);
      } else {
        toast.error('Invalid link format.');
      }
    } catch (err) {
      // If it's just a room ID
      navigate(`/receive/${manualLink.trim()}`);
    }
  };

  useEffect(() => {
    if (status === 'scanning' && scanMethod === 'camera') {
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;
      
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(console.error);
          }
          handleScanSuccess(decodedText);
        },
        (errorMessage) => {
          // ignore errors during scanning
        }
      ).catch(err => {
        console.error("Error starting camera", err);
        toast.error("Could not access camera. Please check permissions.");
      });

      return () => {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(console.error);
        }
      };
    }
  }, [status, scanMethod, navigate]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Receive Files</h1>
        <p className="text-gray-500 dark:text-gray-400">Secure peer-to-peer file transfer</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8">
        {status === 'scanning' && (
          <div className="flex flex-col items-center justify-center space-y-6">
            <h2 className="text-xl font-medium">Scan QR Code</h2>
            
            <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-xl w-full max-w-sm">
              <button
                onClick={() => setScanMethod('camera')}
                className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  scanMethod === 'camera' 
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Camera className="w-4 h-4" />
                <span>Camera</span>
              </button>
              <button
                onClick={() => setScanMethod('file')}
                className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  scanMethod === 'file' 
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span>Upload</span>
              </button>
            </div>

            {scanMethod === 'camera' ? (
              <div className="w-full max-w-sm">
                <div id="reader" className="mx-auto w-full overflow-hidden rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 aspect-square flex items-center justify-center"></div>
                <p className="mt-4 text-center text-sm text-gray-500">Point your camera at the sender's QR code</p>
              </div>
            ) : (
              <div className="w-full max-w-sm">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer mx-auto w-full overflow-hidden rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 aspect-square flex flex-col items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <Upload className="w-12 h-12 text-gray-400 mb-4" />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Click to upload QR code</p>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG or WEBP</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileUpload}
                />
                <div id="reader-hidden" className="hidden"></div>
              </div>
            )}

            <div className="w-full max-w-sm flex items-center py-2">
              <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
              <span className="flex-shrink-0 mx-4 text-sm text-gray-400 font-medium uppercase tracking-wider">Or</span>
              <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
            </div>

            <form onSubmit={handleManualSubmit} className="w-full max-w-sm">
              <label htmlFor="link-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Enter Link or Room ID
              </label>
              <div className="relative flex items-center">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LinkIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="link-input"
                  value={manualLink}
                  onChange={(e) => setManualLink(e.target.value)}
                  className="block w-full pl-10 pr-24 py-3 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
                  placeholder="e.g. https://... or ID"
                />
                <button
                  type="submit"
                  disabled={!manualLink.trim()}
                  className="absolute right-1.5 top-1.5 bottom-1.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Connect
                </button>
              </div>
            </form>
          </div>
        )}

        {status === 'connecting' && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Connecting to Peer...</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">Establishing secure WebRTC connection</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="py-4">
            {files.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Download className="w-8 h-8 text-blue-500" />
                </div>
                <h2 className="text-xl font-medium text-gray-900 dark:text-white">Connected!</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Waiting for sender to select files...</p>
              </div>
            ) : (
              <FileQueue files={files} />
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-8">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-red-900 dark:text-red-100 mb-2">Connection Lost</h2>
            <p className="text-red-700 dark:text-red-300 mb-6">The connection to the sender was lost.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-full transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
