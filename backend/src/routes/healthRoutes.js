const { Router } = require('express');

const router = Router();

// Endpoint simples para monitoramento e teste de disponibilidade.
router.get('/', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'acedia-deck-backend',
    timestamp: new Date().toISOString(),
  });
});

module.exports = { healthRoutes: router };
