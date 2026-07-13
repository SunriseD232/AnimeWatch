import HlsProbe from '@/components/HlsProbe';

export const metadata = { title: 'Probe: AniLibria — AnimeWatch' };

// Прототип для проверки альтернативного видео-движка (AniLibria + hls.js).
// Не часть основного флоу — временная страница для верификации.
export default function ProbePage() {
  return <HlsProbe />;
}
