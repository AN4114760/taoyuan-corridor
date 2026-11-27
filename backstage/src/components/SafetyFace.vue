<script setup lang="ts">
// 安全感 1–5 的表情（取代 emoji）：扁平色塊＋深炭灰描邊，顏色由紅到綠
const props = defineProps<{ level: number; size?: number }>()
const FILL = ['#FCA5A5', '#FDBA74', '#FDE68A', '#BEF264', '#86EFAC']
const MOUTH = [
  'M 12 30 Q 20 22 28 30',   // 很不安全：大嘴角向下
  'M 13 29 Q 20 25 27 29',   // 不安全
  'M 13 27 L 27 27',         // 普通
  'M 13 25 Q 20 30 27 25',   // 安全
  'M 12 24 Q 20 34 28 24 Z', // 很安全：張嘴笑
]
const fill = () => FILL[props.level - 1]
</script>

<template>
  <svg :width="size ?? 34" :height="size ?? 34" viewBox="0 0 40 40" aria-hidden="true">
    <g stroke="#22292F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="20" cy="20" r="17" :fill="fill()" />
      <path v-if="level === 1" d="M 10 14 L 16 11 M 30 14 L 24 11" fill="none" />
      <circle cx="14.5" cy="18.5" r="2" fill="#22292F" stroke="none" />
      <circle cx="25.5" cy="18.5" r="2" fill="#22292F" stroke="none" />
      <path :d="MOUTH[level - 1]" :fill="level === 5 ? '#FFFFFF' : 'none'" />
    </g>
  </svg>
</template>
