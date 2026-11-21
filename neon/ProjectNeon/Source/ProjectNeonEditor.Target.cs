using UnrealBuildTool;

public class ProjectNeonEditorTarget : TargetRules
{
	public ProjectNeonEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("ProjectNeon");
	}
}
