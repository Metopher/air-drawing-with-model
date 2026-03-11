import { useEffect, useRef, useState } from "react";
import { Trash2, Check, ArrowRight, RefreshCw } from "lucide-react";
import * as tf from '@tensorflow/tfjs';

const WORDS_TO_LEARN = ["A", "B", "C", "D", "E", "CAT", "DOG", "SUN"];

function Learn() {
    const videoRef = useRef(null);
    const videoCanvasRef = useRef(null);
    const drawCanvasRef = useRef(null);
    const [targetWord, setTargetWord] = useState(WORDS_TO_LEARN[0]);
    const [feedback, setFeedback] = useState("");
    const [isChecking, setIsChecking] = useState(false);
    const [wordIndex, setWordIndex] = useState(0);
    const [currentLetterIndex, setCurrentLetterIndex] = useState(0);
    const [model, setModel] = useState(null);

    let lastPoint = null;
    let isProcessing = false;

    useEffect(() => {
        // Load TensorFlow model
        const loadModel = async () => {
            try {
                const loadedModel = await tf.loadLayersModel("/model/model.json");
                setModel(loadedModel);
                console.log("Model loaded successfully");
            } catch (err) {
                console.error("Failed to load model:", err);
            }
        };
        loadModel();

        const video = videoRef.current;
        const videoCanvas = videoCanvasRef.current;
        const drawCanvas = drawCanvasRef.current;

        if (!video || !videoCanvas || !drawCanvas) return;

        const vCtx = videoCanvas.getContext("2d");
        const dCtx = drawCanvas.getContext("2d");

        const hands = new window.Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7,
        });

        hands.onResults((results) => {
            if (results.multiHandLandmarks?.length) {
                const lm = results.multiHandLandmarks[0];

                // Landmarks
                const indexTip = lm[8];
                const indexPIP = lm[6];

                const middleTip = lm[12];
                const ringTip = lm[16];
                const pinkyTip = lm[20];

                // 👆 Index finger pointed condition
                const indexUp = indexTip.y < indexPIP.y;
                const middleUp = middleTip.y < lm[10].y;

                // Other fingers down
                const othersDown =
                    ringTip.y > lm[14].y &&
                    pinkyTip.y > lm[18].y;

                // Draw: Index UP, Middle DOWN, Others DOWN
                const isDrawing = indexUp && !middleUp && othersDown;

                // Erase: Index UP, Middle UP, Others DOWN
                const isErasing = indexUp && middleUp && othersDown;

                if (isDrawing || isErasing) {
                    const x = (1 - indexTip.x) * drawCanvas.width;
                    const y = indexTip.y * drawCanvas.height;

                    if (isErasing) {
                        dCtx.globalCompositeOperation = "destination-out";
                        dCtx.lineWidth = 30; // Thicker for eraser
                        dCtx.lineCap = "round";
                    } else {
                        dCtx.globalCompositeOperation = "source-over";
                        dCtx.strokeStyle = "#3b82f6";
                        dCtx.lineWidth = 12; // Thicker line for better OCR
                        dCtx.lineCap = "round";
                    }

                    if (lastPoint) {
                        dCtx.beginPath();
                        dCtx.moveTo(lastPoint.x, lastPoint.y);
                        dCtx.lineTo(x, y);
                        dCtx.stroke();
                    }

                    lastPoint = { x, y };
                } else {
                    lastPoint = null;
                }
            } else {
                lastPoint = null;
            }
        });

        // Camera loop
        navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
            video.srcObject = stream;
            video.play();

            const processFrame = async () => {
                if (video.readyState === 4) {
                    // Always render the camera feed continuously
                    vCtx.save();
                    vCtx.scale(-1, 1);
                    vCtx.drawImage(
                        video,
                        -videoCanvas.width,
                        0,
                        videoCanvas.width,
                        videoCanvas.height
                    );
                    vCtx.restore();

                    if (!isProcessing) {
                        isProcessing = true;
                        // send to mediapipe without blocking camera render loop
                        hands.send({ image: video }).then(() => {
                            isProcessing = false;
                        }).catch((err) => {
                            console.error(err);
                            isProcessing = false;
                        });
                    }
                }
                requestAnimationFrame(processFrame);
            };

            processFrame();
        });
    }, []);

    const clearCanvas = () => {
        const canvas = drawCanvasRef.current;
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        setFeedback("");
    };

    const nextWord = () => {
        const nextIndex = (wordIndex + 1) % WORDS_TO_LEARN.length;
        setWordIndex(nextIndex);
        setTargetWord(WORDS_TO_LEARN[nextIndex]);
        setCurrentLetterIndex(0);
        clearCanvas();
    };

    const checkAccuracy = async () => {
        if (!model) {
            setFeedback("Model not loaded yet. Please wait.");
            return;
        }

        setIsChecking(true);
        setFeedback("Analyzing...");

        const canvas = drawCanvasRef.current;

        try {
            // Get bounding box of the drawing to center and crop it
            const ctx = canvas.getContext("2d");
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
            let hasDrawing = false;
            
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const alpha = data[(y * canvas.width + x) * 4 + 3];
                    if (alpha > 0) {
                        hasDrawing = true;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            if (!hasDrawing) {
                setFeedback("Please draw something first!");
                setIsChecking(false);
                return;
            }
            
            // Add some padding
            const padding = 20;
            minX = Math.max(0, minX - padding);
            minY = Math.max(0, minY - padding);
            maxX = Math.min(canvas.width, maxX + padding);
            maxY = Math.min(canvas.height, maxY + padding);
            
            const width = maxX - minX;
            const height = maxY - minY;
            const size = Math.max(width, height);
            
            // Create a square canvas to center the drawing
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 28;
            tempCanvas.height = 28;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Fill with black background (assuming model expects white text on black like MNIST/EMNIST)
            tempCtx.fillStyle = "black";
            tempCtx.fillRect(0, 0, 28, 28);
            
            // Calculate centering offsets
            const offsetX = (size - width) / 2;
            const offsetY = (size - height) / 2;
            
            // Draw cropped part onto temp canvas resized to 28x28
            tempCtx.drawImage(
                canvas,
                minX, minY, width, height, // Source crop
                (offsetX / size) * 28, (offsetY / size) * 28, (width / size) * 28, (height / size) * 28 // Destination
            );

            // Make the stroke pure white for max contrast
            const tempImageData = tempCtx.getImageData(0, 0, 28, 28);
            const tempData = tempImageData.data;
            for (let i = 0; i < tempData.length; i += 4) {
                // If the pixel is not completely black, make it white based on its alpha/intensity
                const r = tempData[i];
                const g = tempData[i+1];
                const b = tempData[i+2];
                // Blue stroke heavily influences the blue channel
                if (b > 10) { 
                    tempData[i] = 255;
                    tempData[i+1] = 255;
                    tempData[i+2] = 255;
                }
            }
            tempCtx.putImageData(tempImageData, 0, 0);

            // Convert to tensor, grayscale, and normalize
            let tensor = tf.browser.fromPixels(tempCanvas, 1) // 1 channel (grayscale)
                .toFloat()
                .div(tf.scalar(255))
                .expandDims(0); // Add batch dimension: shape [1, 28, 28, 1]

            // === DEBUGGING OUTPUT ===
            // Show exactly what the model sees on the screen
            let debugCanvas = document.getElementById("debugCanvas");
            if (debugCanvas) {
                debugCanvas.remove()
            }
            // ========================

            // Predict
            const predictions = await model.predict(tensor).data();
            const predictedIndex = predictions.indexOf(Math.max(...predictions));
            
            // Common EMNIST Balanced mapping (47 classes)
            const emnistMapping = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghnqrt";
            const recognizedChar = emnistMapping[predictedIndex];

            console.log("Predicted Index:", predictedIndex, "Char:", recognizedChar);
            
            const targetChar = targetWord[currentLetterIndex].toUpperCase();
            if (targetChar === recognizedChar.toUpperCase()) {
                const nextIndex = currentLetterIndex + 1;
                setCurrentLetterIndex(nextIndex);
                
                if (nextIndex >= targetWord.length) {
                    setFeedback(`Perfect! You wrote "${targetWord}" 🎉`);
                } else {
                    setFeedback(`Correct '${targetChar}'! Now draw '${targetWord[nextIndex]}'`);
                    // Clear the canvas for the next letter
                    const canvas = drawCanvasRef.current;
                    const ctx = canvas.getContext("2d");
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            } else {
                setFeedback(`Try again! Detected: "${recognizedChar || '?'}" instead of "${targetChar}"`);
            }

            // Cleanup
            tensor.dispose();
        } catch (error) {
            console.error("Prediction error:", error);
            setFeedback("Error analyzing. Try again.");
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div style={{ textAlign: "center", padding: "2rem" }}>
            <h2 className="text-2xl font-bold" style={{ marginBottom: "1rem" }}>
                Learn to Write
            </h2>

            <div style={{ marginBottom: "2rem" }}>
                <p className="text-secondary" style={{ marginBottom: "0.5rem" }}>Draw this:</p>
                <div style={{
                    fontSize: "4rem",
                    fontWeight: "bold",
                    letterSpacing: "0.5rem"
                }}>
                    {targetWord.split("").map((letter, i) => {
                        let color = "inherit";
                        if (i < currentLetterIndex) {
                            color = "#10b981"; // green for completed
                        } else if (i === currentLetterIndex) {
                            color = "var(--accent)"; // highlight current letter
                        }
                        return (
                            <span key={i} style={{ color, transition: "color 0.3s ease" }}>
                                {letter}
                            </span>
                        );
                    })}
                </div>
                <p className="text-secondary" style={{ minHeight: "1.5rem", color: feedback.includes("Correct") ? "#10b981" : "inherit" }}>
                    {feedback}
                </p>
            </div>

            <div style={{ marginBottom: "2rem", display: "flex", justifyContent: "center", gap: "1rem" }}>
                <button onClick={clearCanvas} className="btn btn-outline" disabled={isChecking}>
                    <Trash2 size={18} /> Clear
                </button>
                <button onClick={checkAccuracy} className="btn btn-primary" disabled={isChecking || currentLetterIndex >= targetWord.length}>
                    {isChecking ? <RefreshCw className="animate-spin" size={18} /> : <Check size={18} />} Check
                </button>
                <button onClick={nextWord} className="btn btn-outline" disabled={isChecking}>
                    Next <ArrowRight size={18} />
                </button>
            </div>

            <div className="drawing-container">
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ display: "none" }}
                />

                {/* Video layer */}
                <canvas
                    ref={videoCanvasRef}
                    width="800"
                    height="600"
                />

                {/* Drawing layer */}
                <canvas
                    ref={drawCanvasRef}
                    width="800"
                    height="600"
                    style={{ pointerEvents: "none" }}
                />
            </div>
        </div>
    );
}

export default Learn;
