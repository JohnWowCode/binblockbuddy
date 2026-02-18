// Simple GIF Encoder (based on NeuQuant algorithm)
export class SimpleGIFEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.transparent = null;
        this.repeat = -1;
        this.delay = 0;
        this.started = false;
        this.out = new ByteArray();
        this.image = null;
        this.pixels = null;
        this.indexedPixels = null;
        this.colorDepth = null;
        this.colorTab = null;
        this.usedEntry = [];
        this.palSize = 7;
        this.dispose = -1;
        this.firstFrame = true;
        this.sample = 10;
    }
    
    setDelay(ms) { this.delay = Math.round(ms / 10); }
    setRepeat(iter) { this.repeat = iter; }
    setTransparent(c) { this.transparent = c; }
    
    start() {
        this.out = new ByteArray();
        this.out.writeUTFBytes("GIF89a");
        this.started = true;
    }
    
    addFrame(ctx) {
        if (!this.started) this.start();
        
        this.image = ctx.getImageData(0, 0, this.width, this.height).data;
        this.getImagePixels();
        this.analyzePixels();
        
        if (this.firstFrame) {
            this.writeLSD();
            this.writePalette();
            if (this.repeat >= 0) {
                this.writeNetscapeExt();
            }
        }
        
        this.writeGraphicCtrlExt();
        this.writeImageDesc();
        if (!this.firstFrame) this.writePalette();
        this.writePixels();
        this.firstFrame = false;
    }
    
    finish() {
        if (!this.started) return;
        this.started = false;
        this.out.writeByte(0x3b);
    }
    
    stream() { return this.out; }
    
    getImagePixels() {
        const w = this.width;
        const h = this.height;
        this.pixels = [];
        const data = this.image;
        let count = 0;
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                const b = i * w * 4 + j * 4;
                this.pixels[count++] = data[b];
                this.pixels[count++] = data[b + 1];
                this.pixels[count++] = data[b + 2];
            }
        }
    }
    
    analyzePixels() {
        const len = this.pixels.length;
        const nPix = len / 3;
        this.indexedPixels = [];
        
        // Build simple color table (256 colors max)
        const colorMap = new Map();
        const colors = [];
        
        for (let i = 0; i < nPix; i++) {
            const r = this.pixels[i * 3];
            const g = this.pixels[i * 3 + 1];
            const b = this.pixels[i * 3 + 2];
            const key = (r << 16) | (g << 8) | b;
            
            if (!colorMap.has(key) && colors.length < 256) {
                colorMap.set(key, colors.length);
                colors.push([r, g, b]);
            }
        }
        
        // Pad to power of 2
        while (colors.length < 256) {
            colors.push([0, 0, 0]);
        }
        
        this.colorTab = [];
        for (const [r, g, b] of colors) {
            this.colorTab.push(r, g, b);
        }
        
        // Map pixels to indices
        for (let i = 0; i < nPix; i++) {
            const r = this.pixels[i * 3];
            const g = this.pixels[i * 3 + 1];
            const b = this.pixels[i * 3 + 2];
            const key = (r << 16) | (g << 8) | b;
            this.indexedPixels[i] = colorMap.get(key) || 0;
        }
        
        this.colorDepth = 8;
        this.palSize = 7;
    }
    
    writeLSD() {
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(0x80 | this.palSize);
        this.out.writeByte(0);
        this.out.writeByte(0);
    }
    
    writePalette() {
        this.out.writeBytes(this.colorTab);
    }
    
    writeNetscapeExt() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xff);
        this.out.writeByte(11);
        this.out.writeUTFBytes("NETSCAPE2.0");
        this.out.writeByte(3);
        this.out.writeByte(1);
        this.out.writeShort(this.repeat);
        this.out.writeByte(0);
    }
    
    writeGraphicCtrlExt() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xf9);
        this.out.writeByte(4);
        this.out.writeByte(0);
        this.out.writeShort(this.delay);
        this.out.writeByte(0);
        this.out.writeByte(0);
    }
    
    writeImageDesc() {
        this.out.writeByte(0x2c);
        this.out.writeShort(0);
        this.out.writeShort(0);
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(this.firstFrame ? 0 : 0x80 | this.palSize);
    }
    
    writePixels() {
        const enc = new LZWEncoder(this.width, this.height, this.indexedPixels, this.colorDepth);
        enc.encode(this.out);
    }
}

export class ByteArray {
    constructor() { this.data = []; }
    getData() { return new Uint8Array(this.data); }
    writeByte(val) { this.data.push(val & 0xff); }
    writeShort(val) { this.writeByte(val & 0xff); this.writeByte((val >> 8) & 0xff); }
    writeBytes(arr) { for (let i = 0; i < arr.length; i++) this.writeByte(arr[i]); }
    writeUTFBytes(str) { for (let i = 0; i < str.length; i++) this.writeByte(str.charCodeAt(i)); }
}

export class LZWEncoder {
    constructor(width, height, pixels, colorDepth) {
        this.width = width;
        this.height = height;
        this.pixels = pixels;
        this.initCodeSize = Math.max(2, colorDepth);
    }
    
    encode(outs) {
        outs.writeByte(this.initCodeSize);
        
        const clearCode = 1 << this.initCodeSize;
        const eoiCode = clearCode + 1;
        let nextCode = eoiCode + 1;
        let codeSize = this.initCodeSize + 1;
        let maxCode = (1 << codeSize) - 1;
        
        const table = new Map();
        const buffer = [];
        
        const output = (code) => {
            buffer.push(code);
        };
        
        output(clearCode);
        
        let current = this.pixels[0];
        for (let i = 1; i < this.pixels.length; i++) {
            const next = this.pixels[i];
            const combined = (current << 12) | next;
            
            if (table.has(combined)) {
                current = table.get(combined);
            } else {
                output(current);
                if (nextCode < 4096) {
                    table.set(combined, nextCode++);
                    if (nextCode > maxCode && codeSize < 12) {
                        codeSize++;
                        maxCode = (1 << codeSize) - 1;
                    }
                }
                current = next;
            }
        }
        output(current);
        output(eoiCode);
        
        // Pack bits into bytes
        let bitBuffer = 0;
        let bitCount = 0;
        const bytes = [];
        
        for (const code of buffer) {
            bitBuffer |= code << bitCount;
            bitCount += codeSize;
            while (bitCount >= 8) {
                bytes.push(bitBuffer & 0xff);
                bitBuffer >>= 8;
                bitCount -= 8;
            }
        }
        if (bitCount > 0) bytes.push(bitBuffer & 0xff);
        
        // Write sub-blocks
        let pos = 0;
        while (pos < bytes.length) {
            const chunk = Math.min(255, bytes.length - pos);
            outs.writeByte(chunk);
            for (let i = 0; i < chunk; i++) {
                outs.writeByte(bytes[pos++]);
            }
        }
        outs.writeByte(0);
    }
}
