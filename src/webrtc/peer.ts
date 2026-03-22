import { getSocketUrl } from "./socket";

export class PeerConnection {
  private pc: RTCPeerConnection;
  private ws: WebSocket;
  private roomId: string;
  private isInitiator: boolean;
  
  public dataChannel?: RTCDataChannel;
  public onDataChannel?: (channel: RTCDataChannel) => void;
  public onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  public onPeerLeft?: () => void;

  constructor(roomId: string, isInitiator: boolean) {
    this.roomId = roomId;
    this.isInitiator = isInitiator;
    
    this.ws = new WebSocket(getSocketUrl());
    
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    });

    this.setupWebSocket();
    this.setupPeerConnection();
  }

  private setupWebSocket() {
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: "join", room: this.roomId }));
      if (this.isInitiator) {
        // Wait for peer to join before creating offer
      }
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "peer-joined") {
        if (this.isInitiator) {
          this.createOffer();
        }
      } else if (data.type === "peer-left") {
        this.onPeerLeft?.();
      } else if (data.type === "signal") {
        await this.handleSignal(data.payload);
      }
    };
  }

  private setupPeerConnection() {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ candidate: event.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    if (this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel("fileTransfer", {
        ordered: true
      });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
        this.onDataChannel?.(this.dataChannel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    // Handled by sender/receiver classes
  }

  private async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ sdp: this.pc.localDescription });
  }

  private async handleSignal(signal: any) {
    if (signal.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal({ sdp: this.pc.localDescription });
      }
    } else if (signal.candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  private sendSignal(payload: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "signal",
        room: this.roomId,
        payload
      }));
    }
  }

  public close() {
    this.pc.close();
    this.ws.close();
  }
}
