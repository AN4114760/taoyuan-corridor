import { createRouter, createWebHistory } from 'vue-router'

import { useAuth } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/app' },
    // 舊的志工回饋網址（QR code）導到 App
    { path: '/feedback', redirect: '/app/map' },
    { path: '/login', component: () => import('./views/auth/Login.vue'), meta: { title: '登入', guest: true } },
    { path: '/register', component: () => import('./views/auth/Register.vue'), meta: { title: '註冊', guest: true } },
    {
      // 民眾端 App：需要登入；分頁依帳號身分顯示
      path: '/app',
      component: () => import('./views/app/AppShell.vue'),
      meta: { requiresUser: true },
      children: [
        { path: '', redirect: () => useAuth().home },
        { path: 'map', component: () => import('./views/app/MapTab.vue'), meta: { title: '地圖', need: 'volunteer' } },
        { path: 'walk/:segId', component: () => import('./views/app/WalkView.vue'), meta: { title: '走訪回饋', need: 'volunteer', hideTabs: true } },
        { path: 'upload', component: () => import('./views/app/UploadTab.vue'), meta: { title: '錄影上傳', need: 'recorder' } },
        { path: 'records', component: () => import('./views/app/RecordsTab.vue'), meta: { title: '紀錄' } },
        { path: 'records/feedback/:id', component: () => import('./views/app/FeedbackDetail.vue'), meta: { title: '紀錄' } },
        { path: 'me', component: () => import('./views/app/MeTab.vue'), meta: { title: '我的' } },
      ],
    },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      children: [
        { path: '', redirect: '/admin/map' },
        { path: 'map', component: () => import('./views/admin/MapView.vue'), meta: { title: '地圖' } },
        { path: 'progress', component: () => import('./views/admin/Progress.vue'), meta: { title: '執行情況' } },
        { path: 'review', component: () => import('./views/admin/Review.vue'), meta: { title: '複查情況' } },
        { path: 'voices', component: () => import('./views/admin/Voices.vue'), meta: { title: '志工回饋' } },
        { path: 'priorities', component: () => import('./views/admin/Priorities.vue'), meta: { title: '需改善路段' } },
        { path: 'videos', component: () => import('./views/admin/Videos.vue'), meta: { title: '影片' } },
        { path: 'accounts', component: () => import('./views/admin/Accounts.vue'), meta: { title: '帳號' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/app' },
  ],
})

// App 登入檢查：沒登入 → 登入頁；已登入開登入頁 → App；沒有該分頁權限 → 帳號的第一個分頁
router.beforeEach(async (to) => {
  const needsUser = to.matched.some((r) => r.meta.requiresUser)
  if (!needsUser && !to.meta.guest) return true
  const auth = useAuth()
  await auth.init()
  if (to.meta.guest) return auth.user ? auth.home : true
  if (!auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  if ((to.meta.need === 'volunteer' && !auth.isVolunteer) || (to.meta.need === 'recorder' && !auth.isRecorder)) {
    return auth.home === to.path ? true : auth.home
  }
  return true
})

router.afterEach((to) => {
  const t = to.meta.title as string | undefined
  document.title = t ? `${t}｜無障礙廊道` : '無障礙廊道'
})
