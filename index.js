const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Store active Python processes by sessionId
const activeProcesses = {};

const withTimeout = (promise, ms) => {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), ms)
    );
    return Promise.race([promise, timeout]);
};

app.post('/run', async (req, res) => {
    const { code, input = '', sessionId } = req.body;

    // CASE: Submit input to existing process
    if (sessionId && activeProcesses[sessionId]) {
        const pythonProcess = activeProcesses[sessionId];
        if (pythonProcess.stdin.writable) {
            pythonProcess.stdin.write(input + '\n');
            return res.json({
                status: 'input_received',
                output: '',
                requiresInput: true,
                sessionId
            });
        } else {
            delete activeProcesses[sessionId];
            return res.status(400).json({
                output: 'Error: Input stream not writable or process ended.',
                requiresInput: false
            });
        }
    }

    // CASE: Initial code execution
    const currentSessionId = Date.now().toString();
    activeProcesses[currentSessionId] = null; // Reserve the session ID

    const fileName = `temp-${Date.now()}.py`;
    const filePath = path.join(tmpDir, fileName);

    try {
        fs.writeFileSync(filePath, code);
        const pythonProcess = spawn('python', [filePath]);
        activeProcesses[currentSessionId] = pythonProcess;

        let outputBuffer = '';
        let errorBuffer = '';
        const timeoutDuration = 10000;

        pythonProcess.stdout.on('data', (data) => {
            outputBuffer += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorBuffer += data.toString();
        });

        // Send initial input if provided
        if (input && pythonProcess.stdin.writable) {
            pythonProcess.stdin.write(input + '\n');
        }

        await withTimeout(new Promise((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                fs.unlinkSync(filePath);
                delete activeProcesses[currentSessionId];
                resolve();
            });

            pythonProcess.on('error', (err) => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                delete activeProcesses[currentSessionId];
                reject(err);
            });
        }), timeoutDuration);

        const combinedOutput = outputBuffer + errorBuffer;

        const requiresInput =
            combinedOutput.includes('EOFError') ||
            combinedOutput.includes('input') ||
            combinedOutput.trim().endsWith(':');

        return res.json({
            output: combinedOutput,
            requiresInput,
            sessionId: requiresInput ? currentSessionId : null
        });

    } catch (err) {
        console.error('Execution error:', err);
        if (activeProcesses[currentSessionId]) {
            activeProcesses[currentSessionId].kill();
            delete activeProcesses[currentSessionId];
        }
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const errorMessage = err.message.includes('timeout')
            ? 'Code execution timed out.'
            : err.message;

        return res.status(500).json({
            output: `Error: ${errorMessage}`,
            requiresInput: false
        });
    }
});

app.post('/input', (req, res) => {
    const { input, sessionId } = req.body;
    const pythonProcess = activeProcesses[sessionId];
    if (!pythonProcess) {
        return res.status(400).json({ output: 'No active session found', requiresInput: false });
    }

    if (pythonProcess.stdin.writable) {
        pythonProcess.stdin.write(input + '\n');
        return res.json({
            status: 'input_received',
            output: '',
            requiresInput: true,
            sessionId
        });
    } else {
        delete activeProcesses[sessionId];
        return res.status(400).json({
            output: 'Error: Input stream not writable or process ended.',
            requiresInput: false
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
