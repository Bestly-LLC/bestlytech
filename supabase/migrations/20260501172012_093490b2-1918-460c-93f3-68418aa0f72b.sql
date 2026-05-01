DO $$
DECLARE jobs text[] := ARRAY[
  'ai-generate-patterns-batch',
  'auto-retry-failed-patterns',
  'check-system-health',
  'process-dismissal-consensus',
  'reset-failed-patterns-monthly',
  'run-pattern-maintenance-every-6h',
  'process-email-queue'
];
j text;
BEGIN
  FOREACH j IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j);
      RAISE NOTICE 'Unscheduled %', j;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip % (%) ', j, SQLERRM;
    END;
  END LOOP;
END $$;