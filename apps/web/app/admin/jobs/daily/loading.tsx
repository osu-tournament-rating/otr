import {
  DailyTotalsFrame,
  DailyTotalsSkeleton,
  RangeSwitchSkeleton,
} from './DailyTotalsFrame';

export default function DailyTotalsLoading() {
  return (
    <DailyTotalsFrame actions={<RangeSwitchSkeleton />}>
      <DailyTotalsSkeleton />
    </DailyTotalsFrame>
  );
}
