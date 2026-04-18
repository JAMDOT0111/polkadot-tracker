import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createClient } from 'redis'
import { subscanRouter } from './routes/subscan.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: '請求過於頻繁，請稍後再試' }
}))

let redis = null
if (process.env.REDIS_URL) {
  redis = createClient({ url: process.env.REDIS_URL })
  redis.connect().catch(console.error)
}

app.locals.redis = redis

app.use('/api', subscanRouter)

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }))

app.listen(PORT, () => {
  console.log(`[backend] running on port ${PORT}`)
})
