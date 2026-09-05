<script lang="ts">
  let { className = '' }: { className?: string } = $props()
</script>

<span role="img" aria-label="izumi" class="izumi-wordmark {className}"></span>

<style>
  .izumi-wordmark {
    display: inline-block;
    width: 6.8rem;
    height: 2rem;
    background: currentColor;
    -webkit-mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
    mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
  }
</style>
