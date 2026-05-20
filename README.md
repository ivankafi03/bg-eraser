# DecOne Eraser — Private On-Device Background Remover

<p align="center">
  <strong>Remove image backgrounds instantly, 100% free, and completely privately—all on your own device.</strong>
</p>

---

## Key Features

- **100% Private & Secure**: Images never leave your device. All background removal processing is executed locally in your browser using cutting-edge WebAssembly (Wasm).
- **Smart AI Engine**: Automatically detects subjects and erases backgrounds in seconds with precision.
- **Touch-up Brush Editor**: Fine-tune your results with a manual restore/erase brush. Adjust brush size and opacity, and enjoy complete undo/redo capabilities.
- **Batch Processing**: Queue up multiple images at once, process them in the background, and download them all together in a single ZIP file.
- **PWA Support**: Install DecOne Eraser as an app on your computer or mobile device for lightning-fast loading and offline access.
- **Local History**: Instantly view, download, or restore your previously processed images via a local IndexedDB history vault.
- **Custom Backgrounds**: Replace backgrounds with transparent, solid colors, custom images, or pre-selected choices with a live comparison swipe slider.

---

## Technology Stack

- **Frontend**: Semantic HTML5, Vanilla CSS (Premium Dark Mode with Glassmorphism and harmonious RGB gradients).
- **Logic**: Vanilla ES Modules (Modular Javascript).
- **AI Processing**: `@imgly/background-removal` running local WASM model weights directly on your GPU/CPU via WebGL.
- **Data Persistence**: IndexedDB (Local database for historical image tracking).
- **Service Worker**: PWA caching shell (caching assets for fully functional offline capabilities).

---

## How to Run Locally

Since this app uses modern ES modules and Web Workers for AI background removal, it must be run through a local web server (running straight from the file system `file://` will trigger CORS restrictions).

We have included a lightweight Python server for this purpose.

### Prerequisite

Ensure you have **Python 3** installed on your system.

### Steps

1. Clone this repository (or copy files):
   ```bash
   git clone https://github.com/ivankafi03/bg-eraser.git
   cd bg-eraser
   ```

2. Start the local server:
   ```bash
   python server.py
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## Premium User Interface Elements

- **Adaptive Fixed Navbar**: The navbar background transitions to a 50% glassmorphic blur when scrolling. The logo text collapses, and a premium eraser icon animates left-to-right leaving a glowing white path.
- **Visual Comparer**: Compare before and after states interactively using a sliding divider.
- **Custom Interactive Brush**: Dynamic circle cursor matching the exact brush size for tactile painting feedback.
- **Installable Banner**: Subtle app promotion banner to trigger native PWA installation.

---

## License

This project is open-source and free to use. [ivankafi03](https://github.com/ivankafi03).
