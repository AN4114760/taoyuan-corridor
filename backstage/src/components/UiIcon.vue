<script setup lang="ts">
// 介面線條圖示（取代 emoji）：24×24、描邊 currentColor，風格與障礙物素材一致（圓角端點）
defineProps<{ name: 'pin' | 'camera' | 'chat' | 'flag' | 'check' | 'x' | 'menu' | 'locate'; size?: number }>()
</script>

<template>
  <svg :width="size ?? 22" :height="size ?? 22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'pin'">
      <path d="M12 21.5s-6.5-5.6-6.5-11.3a6.5 6.5 0 0 1 13 0c0 5.7-6.5 11.3-6.5 11.3z" />
      <circle cx="12" cy="10.2" r="2.4" />
    </template>
    <template v-else-if="name === 'camera'">
      <path d="M4 8.5Q4 7 5.5 7H8l1.6-2.2h4.8L16 7h2.5Q20 7 20 8.5v9Q20 19 18.5 19h-13Q4 19 4 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </template>
    <template v-else-if="name === 'chat'">
      <path d="M5.5 5h13Q20.5 5 20.5 7v8Q20.5 17 18.5 17H11l-4.5 3.5V17h-1Q3.5 17 3.5 15V7Q3.5 5 5.5 5z" />
      <line x1="8" y1="9.5" x2="16" y2="9.5" /><line x1="8" y1="13" x2="13" y2="13" />
    </template>
    <template v-else-if="name === 'flag'">
      <line x1="5.5" y1="21" x2="5.5" y2="3.5" />
      <path d="M5.5 4.5h11l-2.5 4 2.5 4h-11" />
    </template>
    <polyline v-else-if="name === 'check'" points="4.5 12.5 9.5 17.5 19.5 6.5" />
    <template v-else-if="name === 'x'"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></template>
    <template v-else-if="name === 'menu'"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></template>
    <template v-else-if="name === 'locate'"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></template>
  </svg>
</template>
