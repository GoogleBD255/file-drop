export class FileReceiver {
  private receivedSize = 0;
  public metadata: any;
  
  public onProgress?: (progress: number, speed: number) => void;
  public onComplete?: (file: File) => void;

  private startTime = 0;
  private lastReportTime = 0;
  private lastReportSize = 0;

  private fileHandle?: FileSystemFileHandle;
  private writable?: any; // FileSystemWritableFileStream
  private fallbackBuffers: ArrayBuffer[] = [];
  private useOPFS = false;
  
  private writeQueue: ArrayBuffer[] = [];
  private isWriting = false;
  private isFinished = false;

  constructor(metadata: any) {
    this.metadata = metadata;
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    this.initStorage();
  }

  private async initStorage() {
    try {
      const root = await navigator.storage.getDirectory();
      this.fileHandle = await root.getFileHandle(`transfer_${Date.now()}_${this.metadata.name}`, { create: true });
      this.writable = await (this.fileHandle as any).createWritable();
      this.useOPFS = true;
    } catch (e) {
      console.warn("OPFS not available, falling back to memory", e);
      this.useOPFS = false;
    }
  }

  public receiveChunk(chunk: ArrayBuffer) {
    this.receivedSize += chunk.byteLength;
    this.reportProgress();

    if (this.useOPFS) {
      this.writeQueue.push(chunk);
      this.processWriteQueue();
    } else {
      this.fallbackBuffers.push(chunk);
    }
  }

  private async processWriteQueue() {
    if (this.isWriting || !this.writable) return;
    this.isWriting = true;
    
    while (this.writeQueue.length > 0) {
      const chunk = this.writeQueue.shift();
      if (chunk) {
        try {
          await this.writable.write(chunk);
        } catch (e) {
          console.error("Error writing to OPFS", e);
        }
      }
    }
    
    this.isWriting = false;
    
    if (this.isFinished && this.writeQueue.length === 0) {
      this.finalize();
    }
  }

  private reportProgress() {
    const now = Date.now();
    if (now - this.lastReportTime > 500 || this.receivedSize === this.metadata.size) {
      const progress = this.metadata.size === 0 ? 100 : (this.receivedSize / this.metadata.size) * 100;
      
      const timeDiff = (now - this.lastReportTime) / 1000;
      const bytesDiff = this.receivedSize - this.lastReportSize;
      const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
      
      this.onProgress?.(progress, speed);
      
      this.lastReportTime = now;
      this.lastReportSize = this.receivedSize;
    }
  }

  public finish() {
    if (this.useOPFS) {
      this.isFinished = true;
      if (!this.isWriting && this.writeQueue.length === 0) {
        this.finalize();
      }
    } else {
      this.finalize();
    }
  }

  private async finalize() {
    if (this.useOPFS && this.writable && this.fileHandle) {
      await this.writable.close();
      const file = await this.fileHandle.getFile();
      const finalFile = new File([file], this.metadata.name, { type: this.metadata.fileType });
      this.onComplete?.(finalFile);
    } else {
      const blob = new Blob(this.fallbackBuffers, { type: this.metadata.fileType });
      const file = new File([blob], this.metadata.name, { type: this.metadata.fileType });
      this.fallbackBuffers = []; // Free memory
      this.onComplete?.(file);
    }
  }
}
