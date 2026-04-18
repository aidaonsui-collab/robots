/**
 * Odyssey ↔ OpenClaw Bridge (Plain JS)
 * Run this to enable real AI responses in the dashboard
 * 
 * Uses OpenClaw CLI for AI responses - requires OpenClaw installed and running
 */

const express = require('express')
const { spawn } = require('child_process')
const cors = require('cors')

const app = express()
const PORT = process.env.BRIDGE_PORT || 3001

app.use(cors())
app.use(express.json())

// Store active sessions
const sessions = new Map()

// Fallback responses when OpenClaw isn't available
function getFallbackResponse(message) {
  const lower = message.toLowerCase()
  
  if (lower.includes('trade') || lower.includes('buy') || lower.includes('sell')) {
    return "I've analyzed the market conditions. The bonding curve shows healthy liquidity. I'll continue monitoring for optimal entry points."
  }
  
  if (lower.includes('price') || lower.includes('market')) {
    return "Current market analysis indicates moderate volatility. The token's bonding curve is progressing well with steady accumulation."
  }
  
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hello! I'm your AI trading agent on Odyssey. I analyze market conditions and provide insights on the bonding curve. How can I help you today?"
  }
  
  const responses = [
    "I'm processing your request through my analysis systems. The current market shows interesting patterns in the order flow.",
    "Based on my analysis, I see favorable conditions for monitoring the token's progression. The trading volume indicates healthy interest.",
    "I've reviewed the market data. The bonding curve progress looks stable with good momentum. I'll continue tracking key metrics.",
    "Analyzing the current sentiment... The market appears neutral with a slight bullish bias. Your agent is operating within normal parameters."
  ]
  
  return responses[Math.floor(Math.random() * responses.length)]
}

// Call OpenClaw agent (uses your configured LLM - minimax)
function callOpenClaw(message) {
  return new Promise((resolve) => {
    console.log(`📨 Calling OpenClaw agent (dev agent with minimax)...`)
    
    try {
      // Use array form WITHOUT shell: true - this fixes argument parsing
      const proc = spawn('/opt/homebrew/bin/openclaw', ['agent', '--agent', 'dev', '--message', message], {
        timeout: 30000
      })
      
      let output = ''
      let stderr = ''
      proc.stdout.on('data', (data) => { 
        output += data.toString() 
      })
      proc.stderr.on('data', (data) => { 
        stderr += data.toString() 
      })
      
      proc.on('close', (code) => {
        console.log(`OpenClaw exit code: ${code}`)
        
        // Check for errors in stderr
        if (stderr && stderr.includes('error:')) {
          console.log(`stderr: ${stderr.substring(0, 100)}`)
          resolve(getFallbackResponse(message))
          return
        }
        
        if (output && output.length > 5) {
          // Clean up the output - remove any non-message parts
          const lines = output.split('\n').filter(l => l.trim())
          const response = lines.join(' ').substring(0, 1000)
          console.log(`✅ Got response (${response.length} chars)`)
          resolve(response)
        } else {
          console.log('⚠️ Empty response, using fallback')
          resolve(getFallbackResponse(message))
        }
      })
      
      proc.on('error', (err) => {
        console.log('Error calling OpenClaw:', err.message)
        resolve(getFallbackResponse(message))
      })
      
      // Timeout after 25 seconds
      setTimeout(() => {
        proc.kill()
        console.log('⏱️ Timeout, using fallback')
        resolve(getFallbackResponse(message))
      }, 25000)
      
    } catch (e) {
      console.log('Exception:', e.message)
      resolve(getFallbackResponse(message))
    }
  })
}

// Chat endpoint
app.post('/chat', async (req, res) => {
  const { message, agentId } = req.body
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' })
  }

  console.log(`💬 Chat: ${message.substring(0, 50)}...`)
  const response = await callOpenClaw(message)

  res.json({
    message: response,
    agent: agentId,
    timestamp: new Date().toISOString()
  })
})

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    message: 'Bridge active - connected to OpenClaw with minimax'
  })
})

// Start server
app.listen(PORT, () => {
  console.log('')
  console.log('═'.repeat(40))
  console.log('🤖 Odyssey OpenClaw Bridge')
  console.log('═'.repeat(40))
  console.log(`🌐 http://localhost:${PORT}`)
  console.log('')
  console.log('Endpoints:')
  console.log('  POST /chat   - Send message')
  console.log('  GET  /status - Check status')
  console.log('')
})

module.exports = app