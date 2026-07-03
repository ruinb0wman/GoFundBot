<template>
  <div class="admin-wrapper">
    <iframe src="/sqlite-admin" class="admin-iframe" title="数据库管理" />
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.admin-wrapper {
  height: calc(100vh - 120px);
  border-radius: 8px;
  overflow: hidden;
}

.admin-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
