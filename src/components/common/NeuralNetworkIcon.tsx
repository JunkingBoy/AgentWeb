import { useRef, useEffect, useMemo, useCallback } from 'react'

interface Props {
  variant?: 'icon' | 'background'
}

/* ===== 3D 球体工具 ===== */

interface Node3D {
  x: number; y: number; z: number
}

/** 在球面上生成节点：前后半球都有，含南北极 */
function generateSphere3D(rings: { r: number; n: number; offset: number; sign: number }[]) {
  const nodes: Node3D[] = []
  // 先收集所有环的位置，确定球体半径 = 最大环的半径
  const maxR = Math.max(...rings.map(r => r.r))
  nodes.push({ x: 0, y: 0, z: -maxR }) // 南极
  for (const { r, n, offset, sign } of rings) {
    const z = sign * Math.sqrt(Math.max(0, maxR * maxR - r * r))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + offset
      nodes.push({ x: r * Math.sin(a), y: r * Math.cos(a), z })
    }
  }
  nodes.push({ x: 0, y: 0, z: maxR }) // 北极
  return nodes
}

function dist2_3d(a: Node3D, b: Node3D) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function ringEdges3D(ringSizes: number[]) {
  const edges: [number, number][] = []
  let offset = 0
  for (const sz of ringSizes) {
    if (sz > 1) {
      for (let i = 0; i < sz; i++) edges.push([offset + i, offset + (i + 1) % sz])
    }
    offset += sz
  }
  return edges
}

function crossRingEdges3D(nodes: Node3D[], ringSizes: number[], connect = 2) {
  const edges: [number, number][] = []
  let offset = 0
  for (let ri = 0; ri < ringSizes.length - 1; ri++) {
    const cur = ringSizes[ri], next = ringSizes[ri + 1]
    const no = offset + cur
    for (let i = 0; i < cur; i++) {
      const a = nodes[offset + i]
      const list = Array.from({ length: next }, (_, j) => ({ j, d: dist2_3d(a, nodes[no + j]) }))
        .sort((a, b) => a.d - b.d)
      for (let k = 0; k < Math.min(connect, list.length); k++) edges.push([offset + i, no + list[k].j])
    }
    offset += cur
  }
  return edges
}



/** 绕 Y 轴旋转 */
function rotateY3D(nodes: Node3D[], angle: number): Node3D[] {
  const c = Math.cos(angle), s = Math.sin(angle)
  return nodes.map(n => ({ x: n.x * c + n.z * s, y: n.y, z: -n.x * s + n.z * c }))
}

/** 透视投影：3D → 2D 屏幕坐标 + 深度信息 */
function project(nodes: Node3D[], cx: number, cy: number, fl: number) {
  return nodes.map(n => {
    const d = 1 + n.z / fl
    const scale = 1 / d
    return {
      sx: cx + n.x / d,    // 屏幕 x
      sy: cy - n.y / d,     // 屏幕 y（SVG y 轴向下）
      z: n.z,
      scale,
      opacity: Math.max(0.08, Math.min(1, scale * 0.5 + 0.2)),
    }
  })
}

export default function NeuralNetworkIcon({ variant = 'icon' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isBg = variant === 'background'

  // ===== 旋转状态 =====
  const rotationRef = useRef(0)
  const isDraggingRef = useRef(false)
  const lastXRef = useRef(0)
  const rafRef = useRef<number | undefined>(undefined)

  // ===== 3D 球体参数 =====
  const sphereConfig = useMemo(() => {
    // rings: 每个环的 {半径, 节点数, 偏移角, sign(1=前半球, -1=后半球)}
    const rings = isBg
      ? [{ r: 35, n: 8, offset: Math.PI / 10, sign: -1 }, { r: 50, n: 10, offset: 0, sign: 1 }, { r: 35, n: 8, offset: Math.PI / 10, sign: 1 }]
      : [{ r: 22, n: 6, offset: Math.PI / 6, sign: -1 }, { r: 38, n: 8, offset: 0, sign: 1 }, { r: 22, n: 6, offset: Math.PI / 6, sign: 1 }]
    // ringSizes 包含南北极 (size=1)
    const ringSizes = [1, ...rings.map(r => r.n), 1]
    const nodes3D = generateSphere3D(rings)
    const edges = [
      ...ringEdges3D(ringSizes),
      ...crossRingEdges3D(nodes3D, ringSizes, 3),
    ]
    return { nodes3D, edges, cx: 60, cy: 60, focalLength: isBg ? 160 : 120, nodeR: isBg ? 3.5 : 4.5, coreR: isBg ? 1.2 : 1.8 }
  }, [isBg])

  /** 每帧：旋转 → 投影 → 更新 SVG DOM */
  const renderFrame = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const { nodes3D, edges, cx, cy, focalLength, nodeR, coreR } = sphereConfig

    const rotated = rotateY3D(nodes3D, rotationRef.current * Math.PI / 180)
    const proj = project(rotated, cx, cy, focalLength)

    // 检测当前主题：亮色用较低值，暗色用较高值
    const isDark = document.documentElement.classList.contains('dark')
    const lineOpMul = isBg ? (isDark ? 0.55 : 0.3) : (isDark ? 0.75 : 0.4)
    const nodeOpFloor = isDark ? 0.35 : 0.15
    const blurDev = isDark ? (isBg ? 2.0 : 1.6) : (isBg ? 1.0 : 0.8)

    // 更新 glow 模糊强度
    const blurEl = svg.querySelector<SVGFEGaussianBlurElement>('#ns-glow feGaussianBlur')
    if (blurEl) blurEl.setAttribute('stdDeviation', String(blurDev))

    // 更新连线
    const lines = svg.querySelectorAll<SVGLineElement>('[data-ei]')
    for (let i = 0; i < edges.length; i++) {
      const [i1, i2] = edges[i]
      const p1 = proj[i1], p2 = proj[i2]
      const line = lines[i]
      const avgOp = (p1.opacity + p2.opacity) / 2
      line.setAttribute('x1', String(p1.sx))
      line.setAttribute('y1', String(p1.sy))
      line.setAttribute('x2', String(p2.sx))
      line.setAttribute('y2', String(p2.sy))
      line.setAttribute('opacity', String(avgOp * lineOpMul))
    }

    // 更新节点
    const circles = svg.querySelectorAll<SVGCircleElement>('[data-ni]')
    const cores = svg.querySelectorAll<SVGCircleElement>('[data-ci]')
    const pulses = svg.querySelectorAll<SVGCircleElement>('[data-pi]')

    for (let i = 0; i < proj.length; i++) {
      const p = proj[i]
      const sc = Math.max(0.3, p.scale)
      const op = Math.max(nodeOpFloor, p.opacity)

      if (circles[i]) {
        circles[i].setAttribute('cx', String(p.sx))
        circles[i].setAttribute('cy', String(p.sy))
        circles[i].setAttribute('r', String(nodeR * sc))
        circles[i].setAttribute('opacity', String(op))
      }
      if (cores[i]) {
        cores[i].setAttribute('cx', String(p.sx))
        cores[i].setAttribute('cy', String(p.sy))
        cores[i].setAttribute('r', String(coreR * sc))
        cores[i].setAttribute('opacity', String(op))
      }
      if (pulses[i]) {
        pulses[i].setAttribute('cx', String(p.sx))
        pulses[i].setAttribute('cy', String(p.sy))
      }
    }
  }, [sphereConfig, isBg])

  // ===== requestAnimationFrame 自动旋转 =====
  useEffect(() => {
    const autoSpeed = isBg ? 0.1 : 0.15
    const loop = () => {
      if (!isDraggingRef.current) {
        rotationRef.current = (rotationRef.current + autoSpeed) % 360
        renderFrame()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [isBg, renderFrame])

  // ===== 首次渲染后也立即执行一次 =====
  useEffect(() => { renderFrame() }, [renderFrame])

  // ===== 3D 鼠标跟随 =====
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return
      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      el.style.setProperty('--mouse-x', String(x))
      el.style.setProperty('--mouse-y', String(y))
    }
    el.addEventListener('mousemove', onMove)
    return () => el.removeEventListener('mousemove', onMove)
  }, [])

  // ===== 拖拽 =====
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true
    lastXRef.current = e.clientX
    ;(e.currentTarget as HTMLElement).style.transition = 'none'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const dx = e.clientX - lastXRef.current
    lastXRef.current = e.clientX
    const factor = isBg ? 0.5 : 0.8
    rotationRef.current = (rotationRef.current + dx * factor) % 360
    renderFrame()
  }, [isBg, renderFrame])

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false
    if (containerRef.current) containerRef.current.style.transition = ''
  }, [])

  return (
    <div
      ref={containerRef}
      className={isBg ? 'neural-bg' : 'neural-icon-wrapper'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: 'none' }}
    >
      <div className={isBg ? 'neural-bg-scanline' : 'neural-scanline'} />
      <div className="neural-3d-layer">
        <svg
          ref={svgRef}
          className={isBg ? 'neural-bg-svg' : 'neural-svg'}
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id="ns-nodeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#c7d2fe" />
              <stop offset="60%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </radialGradient>
            <radialGradient id="ns-nodePulse" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#a5b4fc" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="ns-nodeCore" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e0e7ff" />
              <stop offset="40%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#818cf8" />
            </radialGradient>
            <filter id="ns-glow">
              <feGaussianBlur data-blur stdDeviation="1.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g filter="url(#ns-glow)">
            {/* 连线 — JS 每帧更新 x1/y1/x2/y2 */}
            {sphereConfig.edges.map((_, i) => (
              <line key={`e-${i}`} data-ei={i} stroke="#6366f1"
                strokeWidth={isBg ? 0.6 : 0.9} />
            ))}
            {/* 节点外圈 */}
            {sphereConfig.nodes3D.map((_, i) => (
              <circle key={`n-${i}`} data-ni={i} r="0"
                fill="url(#ns-nodeGlow)" stroke="#818cf8" strokeWidth={isBg ? 0.6 : 0.8} />
            ))}
            {/* 节点核心 */}
            {sphereConfig.nodes3D.map((_, i) => (
              <circle key={`c-${i}`} data-ci={i} r="0"
                fill="url(#ns-nodeCore)" />
            ))}
            {/* 脉冲光晕 */}
            {sphereConfig.nodes3D.map((_, i) => (
              <circle key={`p-${i}`} data-pi={i} r={isBg ? 7 : 8}
                fill="url(#ns-nodePulse)" className="neural-pulse" opacity="0" />
            ))}
          </g>
        </svg>
      </div>

      <style>{`
        .neural-icon-wrapper {
          position: relative; width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center;
          border-radius: 18px; overflow: hidden;
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.4s ease;
        }
        .neural-icon-wrapper:hover {
          transform: rotateX(calc(var(--mouse-y, 0) * -12deg)) rotateY(calc(var(--mouse-x, 0) * 12deg)) scale(1.18);
          box-shadow: 0 0 30px rgba(99,102,241,.35), 0 0 60px rgba(99,102,241,.15), 0 0 100px rgba(139,92,246,.1);
        }
        .neural-3d-layer { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .neural-svg { width: 72%; height: 72%; z-index: 1; filter: drop-shadow(0 0 4px rgba(99,102,241,.3)); transition: filter 0.35s ease; }
        .neural-icon-wrapper:hover .neural-svg { filter: drop-shadow(0 0 8px rgba(99,102,241,.5)); }
        .neural-scanline {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(99,102,241,.03) 2px, rgba(99,102,241,.03) 4px);
          pointer-events: none; opacity: 0; transition: opacity .3s ease; z-index: 0;
        }
        .neural-icon-wrapper:hover .neural-scanline { opacity: 1; animation: neuralScanMove 3s linear infinite; }

        .neural-bg {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          overflow: hidden; perspective: 1200px;
          transition: transform .6s cubic-bezier(.34,1.56,.64,1);
          pointer-events: auto; z-index: 0;
        }
        .neural-bg:hover {
          transform: rotateX(calc(var(--mouse-y, 0) * -6deg)) rotateY(calc(var(--mouse-x, 0) * 6deg)) scale(1.03);
        }
        .neural-bg-svg { width: 70%; height: 70%; transition: filter .6s ease, opacity .6s ease; filter: drop-shadow(0 0 6px rgba(99,102,241,.06)); opacity: .13; }
        .neural-bg:hover .neural-bg-svg { filter: drop-shadow(0 0 20px rgba(99,102,241,.18)); opacity: .25; }
        .neural-bg-scanline {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(99,102,241,.01) 3px, rgba(99,102,241,.01) 6px);
          pointer-events: none; opacity: 0; transition: opacity .6s ease; z-index: 1;
        }
        .neural-bg:hover .neural-bg-scanline { opacity: 1; animation: neuralScanMove 4s linear infinite; }

        .neural-pulse { transition: opacity .5s ease; }
        .neural-icon-wrapper:hover .neural-pulse { opacity: .6; animation: neuralPulse 2s ease-in-out infinite; }
        .neural-bg:hover .neural-pulse { opacity: .5; animation: neuralPulse 2.5s ease-in-out infinite; }
        .neural-pulse:nth-child(2) { animation-delay: .12s; }
        .neural-pulse:nth-child(3) { animation-delay: .24s; }
        .neural-pulse:nth-child(4) { animation-delay: .36s; }
        .neural-pulse:nth-child(5) { animation-delay: .48s; }
        .neural-pulse:nth-child(6) { animation-delay: .6s; }
        .neural-pulse:nth-child(7) { animation-delay: .72s; }
        .neural-pulse:nth-child(8) { animation-delay: .84s; }
        .neural-pulse:nth-child(9) { animation-delay: .96s; }
        .neural-pulse:nth-child(10) { animation-delay: 1.08s; }
        .neural-pulse:nth-child(11) { animation-delay: 1.2s; }
        .neural-pulse:nth-child(12) { animation-delay: 1.32s; }
        .neural-pulse:nth-child(13) { animation-delay: 1.44s; }
        .neural-pulse:nth-child(14) { animation-delay: 1.56s; }
        .neural-pulse:nth-child(15) { animation-delay: 1.68s; }
        @keyframes neuralPulse { 0%,100% { transform: scale(1); opacity: .15; } 50% { transform: scale(1.6); opacity: 0; } }
        @keyframes neuralScanMove { 0% { background-position: 0 0; } 100% { background-position: 0 30px; } }
      `}</style>
    </div>
  )
}
