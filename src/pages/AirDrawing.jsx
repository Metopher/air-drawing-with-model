import { useEffect, useRef } from "react";
import { Trash2, Save } from "lucide-react";
import { supabase } from "../supabaseClient";

function AirDrawing() {
    const videoRef = useRef(null);
    const videoCanvasRef = useRef(null);
    const drawCanvasRef = useRef(null);

    let lastPoint = null;
    let isProcessing = false;

    useEffect(() => {
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
            // Always draw live video
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
                const middleUp = middleTip.y < lm[10].y; // Middle finger PIP is index 10

                // Other (Ring & Pinky) fingers down
                const othersDown =
                    ringTip.y > lm[14].y && // Ring finger PIP is index 14
                    pinkyTip.y > lm[18].y;  // Pinky finger PIP is index 18

                // Draw: Index UP, Middle DOWN, Others DOWN
                const isDrawing = indexUp && !middleUp && othersDown;

                // Erase: Index UP, Middle UP, Others DOWN
                const isErasing = indexUp && middleUp && othersDown;

                if (isDrawing || isErasing) {
                    const x = (1 - indexTip.x) * drawCanvas.width;
                    const y = indexTip.y * drawCanvas.height;

                    if (isErasing) {
                        dCtx.globalCompositeOperation = "destination-out";
                        dCtx.lineWidth = 20; // Thicker for eraser
                        dCtx.lineCap = "round";
                    } else {
                        dCtx.globalCompositeOperation = "source-over";
                        dCtx.strokeStyle = "#3b82f6"; // Blue accent color
                        dCtx.lineWidth = 6;
                        dCtx.lineCap = "round";
                    }

                    if (lastPoint) {
                        dCtx.beginPath();
                        dCtx.moveTo(lastPoint.x, lastPoint.y);
                        // Connect to average of index and middle if erasing for smoother feel? 
                        // For now keep tracing index finger for consistency
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

        // Camera loop (stable)
        navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
            video.srcObject = stream;
            video.play();

            const processFrame = async () => {
                if (!isProcessing && video.readyState === 4) {
                    isProcessing = true;
                    await hands.send({ image: video });
                    isProcessing = false;
                }
                requestAnimationFrame(processFrame);
            };

            processFrame();
        });
    }, []);

    const clearCanvas = () => {
        const canvas = drawCanvasRef.current;
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    };

    const saveDrawing = async () => {
        const canvas = drawCanvasRef.current;

        // Check if user is logged in
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            alert("Please sign in to save drawings!");
            return;
        }

        canvas.toBlob(async (blob) => {
            const fileName = `${user.id}/${Date.now()}.png`;
            const { error: uploadError } = await supabase.storage
                .from('drawings')
                .upload(fileName, blob);

            if (uploadError) {
                console.error('Error uploading:', uploadError);
                alert('Failed to upload drawing.');
                return;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('drawings')
                .getPublicUrl(fileName);

            const { error: dbError } = await supabase
                .from('drawings')
                .insert([
                    { user_id: user.id, image_url: publicUrl, title: `Drawing ${new Date().toLocaleTimeString()}` }
                ]);

            if (dbError) {
                console.error('Error saving to db:', dbError);
            } else {
                alert('Drawing saved!');
            }
        });
    };

    return (
        <div style={{ textAlign: "center", padding: "2rem" }}>
            <h2 className="text-2xl font-bold" style={{ marginBottom: "1rem" }}>
                Air Drawing Mode
            </h2>
            <p className="text-secondary" style={{ marginBottom: "2rem" }}>
                Point your index finger to draw. Close your hand to stop.
            </p>

            <div style={{ marginBottom: "2rem", display: "flex", justifyContent: "center", gap: "1rem" }}>
                <button
                    onClick={clearCanvas}
                    className="btn btn-outline"
                >
                    <Trash2 size={18} /> Clear
                </button>
                <button
                    onClick={saveDrawing}
                    className="btn btn-primary"
                >
                    <Save size={18} /> Save & Share
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

export default AirDrawing;
