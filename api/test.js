export default function handler(req, res) {
    res.status(200).json({ 
        success: true,
        message: 'API ORNE funcionando!',
        timestamp: new Date().toISOString()
    });
}