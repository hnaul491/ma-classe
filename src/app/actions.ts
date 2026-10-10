'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMember } from '@/lib/auth/session';
import { canEndLesson, canStartLesson } from '@/lib/lessons/rules';
import { deleteRoom } from '@/lib/livekit/server';
import { createClient } from '@/lib/supabase/server';

function lessonTitle(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  return `Lesson ${day}`;
}

export async function startLesson(): Promise<void> {
  const { member } = await getMember();
  if (!canStartLesson(member)) throw new Error('Only the teacher can start a lesson.');
  const supabase = await createClient();

  const { data: live } = await supabase.from('lessons').select('id').eq('status', 'live').maybeSingle();
  let lessonId = live?.id as string | undefined;

  if (!lessonId) {
    const { data, error } = await supabase
      .from('lessons')
      .insert({ title: lessonTitle(new Date()), status: 'live' })
      .select('id')
      .single();
    if (error?.code === '23505') {
      // Started from another tab a moment ago; use that lesson.
      const { data: again } = await supabase.from('lessons').select('id').eq('status', 'live').single();
      lessonId = again?.id;
    } else if (error) {
      throw new Error(error.message);
    } else {
      lessonId = data.id;
    }
  }
  if (!lessonId) throw new Error('Could not start the lesson. Try again.');
  redirect(`/lesson/${lessonId}`);
}

export async function endLesson(lessonId: string): Promise<void> {
  const { member } = await getMember();
  if (!canEndLesson(member)) throw new Error('Only the teacher can end a lesson.');
  const supabase = await createClient();
  const { error } = await supabase
    .from('lessons')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', lessonId)
    .eq('status', 'live');
  if (error) throw new Error(error.message);
  // Deleting the LiveKit room disconnects everyone with reason ROOM_DELETED.
  await deleteRoom(lessonId);
  revalidatePath('/');
}
