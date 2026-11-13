export interface TaskManagerPromptDefaults {
  defaultAssigneeAgentId?: string;
}

export const buildTaskManagerDefaultsBlock = ({
  defaultAssigneeAgentId,
}: TaskManagerPromptDefaults): string[] => {
  if (!defaultAssigneeAgentId) return [];

  return [
    '<task_manager_defaults>',
    `Default Biber agent id: ${defaultAssigneeAgentId}`,
    'Use this id as assigneeAgentId when you decide a task should be assigned to the default Biber assistant.',
    "Do not use it as a listTasks filter unless the user asks for Biber's tasks.",
    '</task_manager_defaults>',
    '',
  ];
};

export const buildTaskManagerDefaultsPrompt = (defaults: TaskManagerPromptDefaults): string =>
  buildTaskManagerDefaultsBlock(defaults).join('\n').trim();
