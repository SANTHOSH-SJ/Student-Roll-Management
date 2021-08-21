import { getRepository, In, MoreThan, getConnection } from "typeorm";
import { NextFunction, Request, Response } from "express";
import { CreateGroupInput, UpdateGroupInput } from '../interface/group.interface'
import { CreateGroupStudentInput } from "../interface/group-student.interface"
import { Roll } from "../entity/roll.entity";
import { Group } from "../entity/group.entity";
import { Student } from "../entity/student.entity";
import { GroupStudent } from "../entity/group-student.entity";
import { StudentRollState } from "../entity/student-roll-state.entity";

export class GroupController {

  private groupRepository = getRepository(Group);
  private groupStudentRepository = getRepository(GroupStudent)
  private studentRollStateRepository = getRepository(StudentRollState);
  private rollRepository = getRepository(Roll);
  private studentRepository = getRepository(Student);

  async allGroups(request: Request, response: Response, next: NextFunction) {
    // Task 1: 
    // Return the list of all groups
    return this.groupRepository.find();
  }

  async createGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1: 
    // Add a Group
    const { body: params } = request;
    const createGroupInput: CreateGroupInput = {
      name: params.name,
      number_of_weeks: params.number_of_weeks,
      roll_states: params.roll_states.toString(),
      incidents: params.incidents,
      ltmt: params.ltmt,
      student_count: 0
    };
    // input is not validated or sanitized as it is only for demo purpose
    const group = new Group();
    group.prepareToCreate(createGroupInput);
    return this.groupRepository.save(group);
  }

  async updateGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1: 
    // Update a Group
    try {
      const { body: params } = request;
      const updateGroupInput: UpdateGroupInput = {
        id: params.id,
        name: params.name,
        number_of_weeks: params.number_of_weeks,
        roll_states: params.roll_states,
        incidents: params.incidents,
        ltmt: params.ltmt
      };
      const group = await this.groupRepository.findOne(params.id);
      if (!group)
        throw new Error("Invalid group id provided");
      // input is not validated or sanitized as it is only for demo purpose
      group.prepareToUpdate(updateGroupInput);
      return this.groupRepository.save(group);
    } catch (error) {
      return { error: error.message };
    }


  }

  async removeGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1: 
    // Delete a Group
    try {
      const groupToRemove = await this.groupRepository.findOne(request.params.id);
      if (!groupToRemove)
        throw new Error("Unable to delete Group. Invalid groupId provided");
      return await this.groupRepository.remove(groupToRemove);
    } catch (error) {
      return { error: error.message };
    }
  }

  async getGroupStudents(request: Request, response: Response, next: NextFunction) {
    // Task 1: 
    try {

      const groupId = request.params.id;

      const studentGroups = await this.groupStudentRepository.find({
        where: { group_id: groupId },
        select: ["student_id"],

      });
      if (!studentGroups) {
        return { error: "Invalid GroupId" }
      }

      const studentIds = studentGroups.map(studentGroup => studentGroup.student_id);

      return (await getRepository(Student)
        .createQueryBuilder("student")
        .select(["student.id", "student.first_name", "student.last_name"])
        .addSelect("student.first_name || ' ' ||student.last_name ", "full_name")
        .where("student.id IN(:...studentIds)", { studentIds: studentIds })
        .getMany()
      );
    } catch (error) {
      return { error: error.message }
    }

    // Return the list of Students that are in a Group  
  }


  async runGroupFilters(request: Request, response: Response, next: NextFunction) {
    try {
      // Task 2:
      // 1. Clear out the groups (delete all the students from the groups)
      const allGroupStudents = await this.groupStudentRepository.find()
      await this.groupStudentRepository.remove(allGroupStudents);


      // 2. For each group, query the student rolls to see which students match the filter for the group

      // get all groups
      const groupsList = await this.groupRepository.find();
      if (!groupsList) {
        return { error: "no group to filter" };
      }


      // iterate through each group
      await Promise.all(groupsList.map(async (group) => {
        // to generate backtracking date from current date 
        const now = new Date();
        const number_of_days_before = group.number_of_weeks * 7;
        now.setDate(now.getDate() - number_of_days_before);
        const dateAfter = now.toISOString().split('T')[0];

        // get rolls after the incident date
        const rolls = await this.rollRepository.find({
          where: { completed_at: MoreThan(dateAfter) },
          select: ['id'],
        });

        // construct rollIds
        const rollIds = rolls.map(roll => roll.id)
        // construct roll_states array from string
        const roll_states = group.roll_states.split(',');

        // fetch studentIds by filtering roll_states and rollIds
        const studentRollStates = await this.studentRollStateRepository.find({
          where: { state: In(roll_states), roll_id: In(rollIds) },
          select: ['student_id']
        });

        // construct studentIds from studentRollState class object
        const sutdentIds = studentRollStates.map(studentRollState => studentRollState.student_id);

        // count number of incident for a student
        const studentIncidentList = sutdentIds.reduce((studentIncidentList, studentId) => {
          studentIncidentList[studentId] = ++studentIncidentList[studentId] || 1;
          return studentIncidentList;
        }, {});


        const isLimitGreaterThan = (group.ltmt == ">") ? true : false;
        let student_count = 0;
        for (const studentId in studentIncidentList) {
          const groupStudent = new GroupStudent();

          if (isLimitGreaterThan && studentIncidentList[studentId] > group.incidents) {
            student_count += 1;
            groupStudent.prepareToCreate({
              group_id: group.id,
              student_id: parseInt(studentId),
              incident_count: studentIncidentList[studentId]
            });
            this.groupStudentRepository.save(groupStudent);
          }
          else if (!isLimitGreaterThan && studentIncidentList[studentId] < group.incidents) {
            student_count += 1;
            groupStudent.prepareToCreate({
              group_id: group.id,
              student_id: parseInt(studentId),
              incident_count: studentIncidentList[studentId]
            });
            this.groupStudentRepository.save(groupStudent);
          }

        }
        group.prepareToUpdateComputed({
          id: group.id,
          run_at: new Date(),
          student_count: student_count
        });
        // 3. Add the list of students that match the filter to the group
        this.groupRepository.save(group);
      }));

      return this.groupStudentRepository.find()

    } catch (error) {
      return { error: error.message }
    }

  }
}
