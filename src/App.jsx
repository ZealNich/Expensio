
import React, { useMemo, useRef, useState } from 'react'
import { Upload, BarChart3, Store, Tags, Repeat, ListChecks, Download, ShieldCheck, FileText, Search, AlertCircle } from 'lucide-react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const TABS = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'results', label: 'Results', icon: BarChart3 },
  { id: 'merchants', label: 'Merchants', icon: Store },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'recurring', label: 'Recurring', icon: Repeat },
  { id: 'transactions', label: 'Transactions', icon: ListChecks },
  { id: 'downloads', label: 'Downloads', icon: Download },
]

const CATEGORY_RULES = [
  { category: 'Groceries', terms: ['countdown', 'woolworths', 'new world', 'pak n save', 'paknsave', 'four square'] },
  { category: 'Fuel', terms: ['bp', 'z energy', 'caltex', 'mobil', 'petrol', 'gull'] },
  { category: 'Dining', terms: ['mcdonald', 'kfc', 'burger', 'cafe', 'restaurant', 'sushi', 'pizza', 'ubereats'] },
  { category: 'Utilities', terms: ['mercury', 'contact energy', 'genesis', 'spark', 'vodafone', '2degrees', 'watercare'] },
  { category: 'Shopping', terms: ['kmart', 'warehouse', 'briscoes', 'mitre 10', 'bunnings', 'amazon', 'mighty ape'] },
  { category: 'Transfers', terms: ['mb transfer', 'transfer to', 'transfer ex', 'automatic payment', 'bill payment'] },
  { category: 'Health', terms: ['pharmacy', 'chemist', 'doctor', 'medical', 'dental', 'health'] },
  { category: 'Subscriptions', terms: ['netflix', 'spotify', 'disney', 'apple.com/bill', 'google', 'microsoft', 'adobe'] },
]

function currency(value) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(value || 0)
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function normaliseHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '"' && quoted && next === '"') {
      cell += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (row.length || cell.trim()) rows.push([...row, cell.trim()])
      row = []
      cell = ''
      if (ch === '\r' && next === '\n') i++
    } else {
      cell += ch
    }
  }
  if (row.length || cell.trim()) rows.push([...row, cell.trim()])
  return rows.filter((r) => r.some(Boolean))
}

function parseDate(value, fallbackYear = new Date().getFullYear()) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parts = raw.split(/[\/\-.]/)
  if (parts.length === 3) {
    let [a, b, c] = parts
    if (c.length === 2) c = `20${c}`
    if (a.length === 4) return new Date(Number(a), Number(b) - 1, Number(c))
    return new Date(Number(c), Number(b) - 1, Number(a))
  }
  const parsed = new Date(`${raw} ${fallbackYear}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function iso(date) {
  return date ? date.toISOString().slice(0, 10) : ''
}

function month(date) {
  return date ? date.toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' }) : 'Unknown'
}

function cleanMerchant(description) {
  return String(description || '')
    .replace(/\bcard\s+\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown'
}

function categoryFor(description) {
  const lower = String(description || '').toLowerCase()
  const found = CATEGORY_RULES.find((r) => r.terms.some((term) => lower.includes(term)))
  return found ? found.category : 'Other'
}

function makeTxn({ date, description, debit = 0, credit = 0, balance = null, source, index }) {
  if (!date || !description) return null
  const amount = credit > 0 ? Math.abs(credit) : -Math.abs(debit)
  if (!amount) return null
  return {
    id: `${source}-${index}-${iso(date)}-${description}`,
    date,
    dateText: iso(date),
    month: month(date),
    description,
    merchant: cleanMerchant(description),
    category: categoryFor(description),
    amount,
    debit: amount < 0 ? Math.abs(amount) : 0,
    credit: amount > 0 ? amount : 0,
    balance,
    source,
  }
}

function parseAsbCsv(text, source) {
  const rows = parseCsvRows(text)
  const headerIndex = rows.findIndex((r) => {
    const h = r.map(normaliseHeader)
    return h.some((x) => x.includes('date')) && h.some((x) => x.includes('amount') || x.includes('debit') || x.includes('credit') || x.includes('deposit') || x.includes('withdrawal'))
  })
  if (headerIndex < 0) return []
  const header = rows[headerIndex].map(normaliseHeader)
  const body = rows.slice(headerIndex + 1)
  const find = (...terms) => header.findIndex((h) => terms.some((t) => h === t || h.includes(t)))
  const dateIdx = find('date')
  const descIdx = find('description', 'transaction', 'details', 'particulars', 'narrative', 'payee')
  const amountIdx = find('amount')
  const debitIdx = find('debit', 'withdrawal', 'moneyout')
  const creditIdx = find('credit', 'deposit', 'moneyin')
  const balanceIdx = find('balance')

  return body.map((r, index) => {
    const amount = amountIdx >= 0 ? toNumber(r[amountIdx]) : 0
    const debit = debitIdx >= 0 ? Math.abs(toNumber(r[debitIdx])) : amount < 0 ? Math.abs(amount) : 0
    const credit = creditIdx >= 0 ? Math.abs(toNumber(r[creditIdx])) : amount > 0 ? amount : 0
    return makeTxn({
      date: parseDate(r[dateIdx]),
      description: r[descIdx] || r.filter(Boolean).slice(1, 4).join(' '),
      debit,
      credit,
      balance: balanceIdx >= 0 ? toNumber(r[balanceIdx]) : null,
      source,
      index,
    })
  }).filter(Boolean)
}

async function extractPdfText(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const lines = []
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    const items = content.items.map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }))
    const grouped = new Map()
    for (const item of items) {
      const y = Math.round(item.y)
      if (!grouped.has(y)) grouped.set(y, [])
      grouped.get(y).push(item)
    }
    const pageLines = Array.from(grouped.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    lines.push(...pageLines)
  }
  return lines.join('\n')
}

function statementYear(text) {
  const match = text.match(/Opening date\s+\d{1,2}\s+[A-Za-z]{3}\s+(\d{2,4})/i)
  if (!match) return new Date().getFullYear()
  const raw = match[1]
  return Number(raw.length === 2 ? `20${raw}` : raw)
}

function parseAsbPdf(text, source) {
  const year = statementYear(text)
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const txns = []

  for (const line of lines) {
    if (/Opening Balance|Closing Balance|Balance summary|Transaction details|Bill payment authorities|Account no|Statement no|Page no/i.test(line)) continue
    const match = line.match(/^(\d{1,2}\s+[A-Za-z]{3})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})(?:\s+(-?\$?[\d,]+\.\d{2}))?(?:\s+(-?\$?[\d,]+\.\d{2}))?$/)
    if (!match) continue
    const [, dateText, description, a, b, c] = match
    const date = parseDate(dateText, year)
    const nums = [a, b, c].filter(Boolean).map(toNumber)
    if (!date || nums.length < 2) continue
    const balance = nums[nums.length - 1]
    const movements = nums.slice(0, -1)
    let debit = 0
    let credit = 0
    if (movements.length === 1) {
      const lower = description.toLowerCase()
      if (lower.includes('transfer ex') || lower.includes('deposit') || lower.includes('credit')) credit = Math.abs(movements[0])
      else debit = Math.abs(movements[0])
    } else {
      debit = Math.abs(movements[0])
      credit = Math.abs(movements[1])
    }
    const txn = makeTxn({ date, description, debit, credit, balance, source, index: txns.length })
    if (txn) txns.push(txn)
  }
  return txns
}

function downloadCsv(name, rows) {
  const header = ['Date', 'Merchant', 'Description', 'Category', 'Amount', 'Debit', 'Credit', 'Balance', 'Source']
  const csv = [header, ...rows.map((r) => [r.dateText, r.merchant, r.description, r.category, r.amount, r.debit, r.credit, r.balance ?? '', r.source])]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>
}

export default function App() {
  const [active, setActive] = useState('upload')
  const [transactions, setTransactions] = useState([])
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const inputRef = useRef(null)

  const spend = useMemo(() => transactions.filter((t) => t.amount < 0), [transactions])
  const income = useMemo(() => transactions.filter((t) => t.amount > 0), [transactions])
  const merchants = useMemo(() => {
    const m = new Map()
    spend.forEach((t) => m.set(t.merchant, (m.get(t.merchant) || 0) + t.debit))
    return Array.from(m, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  }, [spend])
  const categories = useMemo(() => {
    const m = new Map()
    spend.forEach((t) => m.set(t.category, (m.get(t.category) || 0) + t.debit))
    return Array.from(m, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  }, [spend])
  const months = useMemo(() => {
    const m = new Map()
    spend.forEach((t) => m.set(t.month, (m.get(t.month) || 0) + t.debit))
    return Array.from(m, ([name, amount]) => ({ name, amount }))
  }, [spend])
  const recurring = useMemo(() => {
    const m = new Map()
    spend.forEach((t) => {
      const key = `${t.merchant}|${Math.round(t.debit)}`
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(t)
    })
    return Array.from(m.values()).filter((items) => items.length > 1).map((items) => ({
      merchant: items[0].merchant,
      amount: items[0].debit,
      category: items[0].category,
      count: items.length,
      total: items.reduce((s, t) => s + t.debit, 0),
    }))
  }, [spend])
  const catOptions = ['All', ...Array.from(new Set(transactions.map((t) => t.category))).sort()]
  const filtered = transactions.filter((t) => {
    const q = query.toLowerCase()
    return (cat === 'All' || t.category === cat) && [t.dateText, t.merchant, t.description, t.category, t.source].join(' ').toLowerCase().includes(q)
  })

  async function processFiles(list) {
    setError('')
    setBusy(true)
    try {
      const found = []
      const fileSummaries = []
      for (const file of Array.from(list || [])) {
        let parsed = []
        if (file.name.toLowerCase().endsWith('.csv')) parsed = parseAsbCsv(await file.text(), file.name)
        if (file.name.toLowerCase().endsWith('.pdf')) parsed = parseAsbPdf(await extractPdfText(file), file.name)
        if (parsed.length) {
          found.push(...parsed)
          fileSummaries.push({ name: file.name, count: parsed.length })
        }
      }
      if (!found.length) {
        setError('No ASB transactions were found. Please use an ASB CSV export or an ASB PDF statement with a transaction table.')
        return
      }
      setTransactions(found.sort((a, b) => b.date - a.date))
      setFiles(fileSummaries)
      setActive('results')
    } catch (e) {
      console.error(e)
      setError('I could not read that PDF/CSV. Please try an ASB CSV export, or another text-based ASB PDF statement.')
    } finally {
      setBusy(false)
    }
  }

  const totalSpend = spend.reduce((s, t) => s + t.debit, 0)
  const totalIncome = income.reduce((s, t) => s + t.credit, 0)

  return (
    <div>
      <header className="top">
        <div className="logo">Expensio</div>
        <nav>
          {TABS.map((tab) => {
            const Icon = tab.icon
            return <button key={tab.id} className={active === tab.id ? 'active' : ''} onClick={() => setActive(tab.id)}><Icon size={16}/>{tab.label}</button>
          })}
        </nav>
      </header>

      <main>
        {active === 'upload' && (
          <section className="hero">
            <div>
              <div className="badge"><ShieldCheck size={16}/> Secure local analysis</div>
              <h1>See where your money goes.</h1>
              <p>Upload ASB CSV exports or PDF statements to inspect merchants, categories, recurring payments, transactions, and downloads.</p>
              <p className="privacy">Files are processed locally in your browser. No bank connection required.</p>
            </div>
            <div className="card">
              <div className="drop" onClick={() => inputRef.current?.click()}>
                <FileText size={48}/>
                <h2>Drag & drop ASB files here</h2>
                <p>or click to browse PDF/CSV files</p>
                <input ref={inputRef} type="file" multiple accept=".csv,.pdf,text/csv,application/pdf" hidden onChange={(e) => processFiles(e.target.files)} />
              </div>
              {error && <div className="error"><AlertCircle size={16}/>{error}</div>}
              <button className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Processing...' : 'Choose files'}</button>
              {files.length > 0 && <div className="files">{files.map((f) => <div key={f.name}>{f.name}<b>{f.count} txns</b></div>)}</div>}
            </div>
          </section>
        )}

        {active !== 'upload' && transactions.length === 0 && <div className="card empty">Upload files first.</div>}

        {active === 'results' && transactions.length > 0 && (
          <section className="stack">
            <div className="stats">
              <Stat label="Total spend" value={currency(totalSpend)} />
              <Stat label="Income" value={currency(totalIncome)} />
              <Stat label="Transactions" value={transactions.length.toLocaleString()} />
              <Stat label="Merchants" value={new Set(transactions.map(t => t.merchant)).size.toLocaleString()} />
            </div>
            <div className="card"><h2>Monthly spending</h2><div className="chart"><ResponsiveContainer><BarChart data={months}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis/><Tooltip formatter={currency}/><Bar dataKey="amount" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div></div>
          </section>
        )}

        {active === 'merchants' && transactions.length > 0 && <div className="card"><h2>Merchants</h2><div className="chart tall"><ResponsiveContainer><BarChart data={merchants.slice(0, 15)} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis type="category" dataKey="name" width={170}/><Tooltip formatter={currency}/><Bar dataKey="amount" radius={[0,8,8,0]}/></BarChart></ResponsiveContainer></div></div>}

        {active === 'categories' && transactions.length > 0 && <section className="split"><div className="card"><h2>Categories</h2><div className="chart"><ResponsiveContainer><PieChart><Pie data={categories} dataKey="amount" nameKey="name" outerRadius={110} label>{categories.map((_, i) => <Cell key={i}/>)}</Pie><Tooltip formatter={currency}/></PieChart></ResponsiveContainer></div></div><div className="card"><h2>Category totals</h2>{categories.map(c => <div className="row" key={c.name}><span>{c.name}</span><b>{currency(c.amount)}</b></div>)}</div></section>}

        {active === 'recurring' && transactions.length > 0 && <div className="card"><h2>Recurring</h2>{recurring.length ? recurring.map(r => <div className="row" key={`${r.merchant}-${r.amount}`}><span><b>{r.merchant}</b><small>{r.category} · seen {r.count} times</small></span><b>{currency(r.amount)}</b></div>) : <p>No recurring transactions found yet.</p>}</div>}

        {active === 'transactions' && transactions.length > 0 && <div className="card"><div className="tools"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search transactions..." /></div><select value={cat} onChange={e=>setCat(e.target.value)}>{catOptions.map(c=><option key={c}>{c}</option>)}</select></div><div className="table"><table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Source</th><th>Amount</th></tr></thead><tbody>{filtered.map(t=><tr key={t.id}><td>{t.dateText}</td><td><b>{t.merchant}</b><small>{t.description}</small></td><td><span className="pill">{t.category}</span></td><td>{t.source}</td><td className={t.amount>0?'positive amount':'amount'}>{currency(t.amount)}</td></tr>)}</tbody></table></div></div>}

        {active === 'downloads' && transactions.length > 0 && <div className="card"><h2>Downloads</h2><p>Export cleaned Expensio data.</p><button className="primary" onClick={() => downloadCsv('expensio-transactions.csv', transactions)}><Download size={16}/> Download all transactions</button></div>}
      </main>
    </div>
  )
}
